import crypto from 'node:crypto';
import {query, withTenant} from './db.js';
import {HttpError} from './http.js';

const collections = {
  modules: {table:'module_definitions', key:'module_key'},
  entities: {table:'entity_types', key:'entity_key'},
  relationships: {table:'relationship_types', key:'relationship_key'},
  commands: {table:'command_definitions', key:'command_key'},
  stateMachines: {table:'state_machine_definitions', key:'state_machine_key'},
  workflows: {table:'workflow_definitions', key:'workflow_key'}
};

function ensureArray(value) { return Array.isArray(value) ? value : []; }
function ensureObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

export function validateBundle(manifest) {
  if (!manifest?.key) throw new HttpError(400, 'Capability bundle key is required', 'bundle_validation_error');
  if (!/^[a-z][a-z0-9_.-]{1,100}$/.test(manifest.key)) throw new HttpError(400, 'Capability bundle key has invalid format', 'bundle_validation_error');
  if (manifest.version !== undefined && (!Number.isInteger(manifest.version) || manifest.version < 1)) throw new HttpError(400, 'Capability bundle version must be a positive integer', 'bundle_validation_error');
  for (const name of Object.keys(collections)) if (manifest[name] !== undefined && !Array.isArray(manifest[name])) throw new HttpError(400, `${name} must be an array`, 'bundle_validation_error');
  for (const module of ensureArray(manifest.modules)) {
    if (!module.key || !module.displayName) throw new HttpError(400, 'Every module requires key and displayName', 'bundle_validation_error');
    if (!ensureObject(module.capabilities)) throw new HttpError(400, `Module ${module.key} capabilities must be an object`, 'bundle_validation_error');
  }
  for (const entity of ensureArray(manifest.entities)) if (!entity.key || !entity.displayName || !entity.schema) throw new HttpError(400, 'Every entity requires key, displayName, and schema', 'bundle_validation_error');
  for (const relation of ensureArray(manifest.relationships)) if (!relation.key || !relation.sourceEntityKey || !relation.targetEntityKey) throw new HttpError(400, 'Every relationship requires key, sourceEntityKey, and targetEntityKey', 'bundle_validation_error');
  for (const command of ensureArray(manifest.commands)) if (!command.key || !command.operation) throw new HttpError(400, 'Every command requires key and operation', 'bundle_validation_error');
  for (const workflow of ensureArray(manifest.workflows)) if (!workflow.key || !workflow.workflowType || !workflow.taskQueue) throw new HttpError(400, 'Every workflow requires key, workflowType, and taskQueue', 'bundle_validation_error');
  return manifest;
}

export async function registerCapabilityBundle(context, actor, manifest) {
  validateBundle(manifest);
  const version = manifest.version || 1;
  return withTenant(context.tenantId, async client => {
    const existing = await client.query(`select id from capability_bundles where tenant_id = $1 and universe_id is not distinct from $2 and bundle_key = $3 and version = $4`, [context.tenantId, context.universeId, manifest.key, version]);
    if (existing.rowCount) throw new HttpError(409, 'Capability bundle version already exists', 'bundle_version_exists');
    const inserted = await client.query(`insert into capability_bundles (tenant_id,universe_id,bundle_key,version,manifest,status,created_by,activated_at) values ($1,$2,$3,$4,$5,'active',$6,now()) returning id,bundle_key as "bundleKey",version,status,created_at as "createdAt",activated_at as "activatedAt"`, [context.tenantId, context.universeId, manifest.key, version, manifest, actor.sub]);
    for (const module of ensureArray(manifest.modules)) await client.query(`insert into module_definitions (tenant_id,universe_id,module_key,display_name,labels,capabilities,entities,config,units,enabled,version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) on conflict (tenant_id,universe_id,module_key) do update set display_name = excluded.display_name,labels = excluded.labels,capabilities = excluded.capabilities,entities = excluded.entities,config = excluded.config,units = excluded.units,enabled = true,version = excluded.version`, [context.tenantId, context.universeId, module.key, module.displayName, module.labels || {}, module.capabilities || {}, module.entities || [], module.config || {}, module.units || [], version]);
    for (const entity of ensureArray(manifest.entities)) await client.query(`insert into entity_types (tenant_id,universe_id,entity_key,display_name,schema,capabilities,lifecycle,status,version) values ($1,$2,$3,$4,$5,$6,$7,'active',$8) on conflict (tenant_id,universe_id,entity_key) do update set display_name = excluded.display_name,schema = excluded.schema,capabilities = excluded.capabilities,lifecycle = excluded.lifecycle,status = 'active',version = excluded.version`, [context.tenantId, context.universeId, entity.key, entity.displayName, entity.schema, entity.capabilities || {}, entity.lifecycle || {}, version]);
    for (const relation of ensureArray(manifest.relationships)) await client.query(`insert into relationship_types (tenant_id,universe_id,relationship_key,source_entity_key,target_entity_key,cardinality,config,status) values ($1,$2,$3,$4,$5,$6,$7,'active') on conflict (tenant_id,universe_id,relationship_key) do update set source_entity_key = excluded.source_entity_key,target_entity_key = excluded.target_entity_key,cardinality = excluded.cardinality,config = excluded.config,status = 'active'`, [context.tenantId, context.universeId, relation.key, relation.sourceEntityKey, relation.targetEntityKey, relation.cardinality || 'many_to_many', relation.config || {}]);
    for (const command of ensureArray(manifest.commands)) await client.query(`insert into command_definitions (tenant_id,universe_id,command_key,entity_type_key,operation,workflow_key,initial_state,input_schema,allowed_roles,idempotent,enabled,version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11) on conflict (tenant_id,universe_id,command_key,version) do update set entity_type_key = excluded.entity_type_key,operation = excluded.operation,workflow_key = excluded.workflow_key,initial_state = excluded.initial_state,input_schema = excluded.input_schema,allowed_roles = excluded.allowed_roles,idempotent = excluded.idempotent,enabled = true`, [context.tenantId, context.universeId, command.key, command.entityTypeKey || null, command.operation, command.workflowKey || null, command.initialState || null, command.inputSchema || {}, command.allowedRoles || [], command.idempotent !== false, version]);
    for (const machine of ensureArray(manifest.stateMachines)) await client.query(`insert into state_machine_definitions (tenant_id,universe_id,state_machine_key,initial_state,states,transitions,enabled,version) values ($1,$2,$3,$4,$5,$6,true,$7) on conflict (tenant_id,universe_id,state_machine_key,version) do update set initial_state = excluded.initial_state,states = excluded.states,transitions = excluded.transitions,enabled = true`, [context.tenantId, context.universeId, machine.key, machine.initialState, machine.states || {}, machine.transitions || {}, version]);
    for (const workflow of ensureArray(manifest.workflows)) await client.query(`insert into workflow_definitions (tenant_id,universe_id,workflow_key,workflow_type,task_queue,trigger_events,signals,retry_policy,input_schema,enabled,version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) on conflict (tenant_id,universe_id,workflow_key,version) do update set workflow_type = excluded.workflow_type,task_queue = excluded.task_queue,trigger_events = excluded.trigger_events,signals = excluded.signals,retry_policy = excluded.retry_policy,input_schema = excluded.input_schema,enabled = true`, [context.tenantId, context.universeId, workflow.key, workflow.workflowType, workflow.taskQueue, workflow.triggerEvents || [], workflow.signals || [], workflow.retryPolicy || {}, workflow.inputSchema || {}, version]);
    if (manifest.experience) await client.query(`insert into configuration_entries (scope_type,scope_key,namespace,config_key,value) values ('universe',$1,'experience','default',$2) on conflict (scope_type,scope_key,namespace,config_key) do update set value = excluded.value,version = configuration_entries.version + 1`, [context.universeId, manifest.experience]);
    return {...inserted.rows[0], registered:{modules:manifest.modules?.length || 0,entities:manifest.entities?.length || 0,relationships:manifest.relationships?.length || 0,commands:manifest.commands?.length || 0,stateMachines:manifest.stateMachines?.length || 0,workflows:manifest.workflows?.length || 0}};
  });
}

export async function listBundles(context) {
  const result = await query(`select id,bundle_key as "bundleKey",version,status,manifest,created_at as "createdAt",activated_at as "activatedAt" from capability_bundles where tenant_id = $1 and (universe_id = $2 or universe_id is null) order by created_at desc`, [context.tenantId, context.universeId]);
  return result.rows;
}
