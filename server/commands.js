import crypto from 'node:crypto';
import {query} from './db.js';
import {HttpError} from './http.js';
import {assertCommandInput, assertEntityData, assertTransition, resolveCommand, resolveEntityType, resolveStateMachine} from './registry.js';

export async function executeCommand(context, actor, commandKey, input, idempotencyKey) {
  if (!idempotencyKey) throw new HttpError(400, 'Idempotency-Key header is required', 'idempotency_required');
  const command = await resolveCommand(context, commandKey);
  if (!command) throw new HttpError(404, `Command is not registered: ${commandKey}`, 'command_not_found');
  const roles = Array.isArray(command.allowed_roles) ? command.allowed_roles : [];
  if (roles.length && !roles.includes(actor.role)) throw new HttpError(403, 'The current role cannot execute this command', 'command_forbidden');
  assertCommandInput(command, input || {});
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(input || {})).digest('hex');
  const existing = await query(`select id,status,request_hash,output,error from command_executions where tenant_id = $1 and actor_id = $2 and idempotency_key = $3`, [context.tenantId, actor.sub, idempotencyKey]);
  if (existing.rowCount) {
    const execution = existing.rows[0];
    if (execution.request_hash && execution.request_hash !== requestHash) throw new HttpError(409, 'Idempotency key was already used with different input', 'idempotency_conflict');
    return execution;
  }
  const execution = await query(`insert into command_executions (tenant_id,universe_id,command_key,command_version,actor_id,idempotency_key,request_hash,input,status) values ($1,$2,$3,$4,$5,$6,$7,$8,'running') returning id,status,command_key as "commandKey",command_version as "commandVersion"`, [context.tenantId, context.universeId, commandKey, command.version, actor.sub, idempotencyKey, requestHash, input || {}]);
  try {
    let output;
    if (command.operation === 'entity.create') output = await createEntity(context, actor, command, input);
    else if (command.operation === 'entity.update') output = await updateEntity(context, command, input);
    else if (command.operation === 'state.transition') output = await transitionEntity(context, command, input);
    else throw new HttpError(501, `Command operation is not implemented by the platform kernel: ${command.operation}`, 'command_operation_unimplemented');
    await query(`update command_executions set status = 'succeeded',output = $2,updated_at = now() where id = $1`, [execution.rows[0].id, output]);
    return {...execution.rows[0], status:'succeeded', output};
  } catch (error) {
    await query(`update command_executions set status = 'failed',error = $2,updated_at = now() where id = $1`, [execution.rows[0].id, {code:error.code || 'command_failed',message:error.message}]);
    throw error;
  }
}

async function createEntity(context, actor, command, input) {
  if (!command.entity_type_key) throw new HttpError(500, 'Entity create command has no entity type', 'invalid_command_definition');
  const type = await resolveEntityType(context, command.entity_type_key);
  assertEntityData(type, input.data || {});
  const result = await query(`insert into entity_records (tenant_id,universe_id,entity_type_id,external_key,data,status,created_by) values ($1,$2,$3,$4,$5,coalesce($6,'active'),$7) returning id,external_key as "externalKey",data,version,status`, [context.tenantId, context.universeId, type.id, input.externalKey || null, input.data || {}, command.initial_state, actor.sub]);
  return result.rows[0];
}

async function updateEntity(context, command, input) {
  if (!command.entity_type_key || !input.entityId) throw new HttpError(400, 'Entity update command requires entityId and entity type', 'command_validation_error');
  const type = await resolveEntityType(context, command.entity_type_key);
  const current = await query(`select data,version from entity_records where id = $1 and tenant_id = $2 and entity_type_id = $3 and status <> 'deleted'`, [input.entityId, context.tenantId, type.id]);
  if (!current.rowCount) throw new HttpError(404, 'Entity record was not found', 'entity_not_found');
  if (input.version !== undefined && Number(input.version) !== Number(current.rows[0].version)) throw new HttpError(409, 'Entity record version conflict', 'entity_version_conflict');
  const data = {...current.rows[0].data, ...(input.data || {})};
  assertEntityData(type, data);
  const result = await query(`update entity_records set data = $1,version = version + 1 where id = $2 and tenant_id = $3 and version = $4 returning id,external_key as "externalKey",data,version,status`, [data, input.entityId, context.tenantId, current.rows[0].version]);
  if (!result.rowCount) throw new HttpError(409, 'Entity record version conflict', 'entity_version_conflict');
  return result.rows[0];
}

async function transitionEntity(context, command, input) {
  if (!command.entity_type_key || !input.entityId || !input.stateMachineKey || !input.fromState || !input.event) throw new HttpError(400, 'State transition command is incomplete', 'command_validation_error');
  const machine = await resolveStateMachine(context, input.stateMachineKey);
  if (!machine) throw new HttpError(404, 'State machine is not registered', 'state_machine_not_found');
  const transition = assertTransition(machine, input.fromState, input.event);
  const type = await resolveEntityType(context, command.entity_type_key);
  const result = await query(`update entity_records set status = $1,version = version + 1 where id = $2 and tenant_id = $3 and entity_type_id = $4 and status = $5 returning id,status,version,data`, [transition.to, input.entityId, context.tenantId, type.id, input.fromState]);
  if (!result.rowCount) throw new HttpError(409, 'Entity state changed or does not match the requested state', 'state_version_conflict');
  return {...result.rows[0], transition:{event:input.event,from:input.fromState,to:transition.to}};
}
