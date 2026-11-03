import {repositories} from './db.js';
import {HttpError} from './http.js';

function schemaError(schema, data, path = '$') {
  if (!schema || schema.type !== 'object') return null;
  if (Array.isArray(schema.required)) {
    const missing = schema.required.filter(key => data?.[key] === undefined || data?.[key] === null);
    if (missing.length) return `${path} is missing required fields: ${missing.join(', ')}`;
  }
  for (const [key, definition] of Object.entries(schema.properties || {})) {
    if (data?.[key] === undefined || data?.[key] === null || !definition.type) continue;
    const actual = Array.isArray(data[key]) ? 'array' : typeof data[key];
    if (definition.type === 'integer' && (!Number.isInteger(data[key]))) return `${path}.${key} must be an integer`;
    if (definition.type !== 'integer' && actual !== definition.type) return `${path}.${key} must be a ${definition.type}`;
  }
  return null;
}

export function assertEntityData(type, data) {
  const error = schemaError(type.schema, data);
  if (error) throw new HttpError(400, error, 'entity_validation_error');
}

export async function resolveEntityType(context, entityKey) {
  const result = await repositories.registry.resolveEntityType(context, entityKey);
  if (!result.rowCount) throw new HttpError(404, `Entity type is not registered: ${entityKey}`, 'entity_type_not_found');
  return result.rows[0];
}

export async function resolveRelationshipType(context, relationshipKey) {
  const result = await repositories.registry.resolveRelationshipType(context, relationshipKey);
  if (!result.rowCount) throw new HttpError(404, `Relationship type is not registered: ${relationshipKey}`, 'relationship_type_not_found');
  return result.rows[0];
}

export async function resolveWorkflow(context, eventType) {
  const result = await repositories.registry.resolveWorkflow(context, eventType);
  return result.rows[0] || null;
}

export async function resolvePolicy(context, policyKey) {
  const result = await repositories.registry.resolvePolicy(context, policyKey);
  return result.rows[0] || null;
}

export async function resolveCommand(context, commandKey) {
  const result = await repositories.registry.resolveCommand(context, commandKey);
  return result.rows[0] || null;
}

export async function resolveStateMachine(context, stateMachineKey) {
  const result = await repositories.registry.resolveStateMachine(context, stateMachineKey);
  return result.rows[0] || null;
}

export function assertCommandInput(command, input) {
  const schema = command.input_schema || {};
  const required = schema.required || [];
  const missing = required.filter(key => input?.[key] === undefined || input?.[key] === null);
  if (missing.length) throw new HttpError(400, `Command input is missing required fields: ${missing.join(', ')}`, 'command_validation_error');
  for (const [key, definition] of Object.entries(schema.properties || {})) {
    if (input?.[key] === undefined || !definition.type) continue;
    const actual = Array.isArray(input[key]) ? 'array' : typeof input[key];
    if (definition.type === 'integer' && !Number.isInteger(input[key])) throw new HttpError(400, `Command input ${key} must be an integer`, 'command_validation_error');
    if (definition.type !== 'integer' && actual !== definition.type) throw new HttpError(400, `Command input ${key} must be a ${definition.type}`, 'command_validation_error');
  }
}

export function assertTransition(machine, fromState, event) {
  const transitions = machine.transitions || {};
  const transition = transitions[fromState]?.[event];
  if (!transition) throw new HttpError(409, `Transition is not allowed from ${fromState} using ${event}`, 'invalid_state_transition');
  return typeof transition === 'string' ? {to:transition} : transition;
}

export async function listEntityTypes(context) {
  const result = await repositories.registry.listEntityTypes(context);
  return result.rows;
}
