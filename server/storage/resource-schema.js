import {HttpError} from '../http.js';

const keyPattern = /^[a-z][a-z0-9_]{1,62}$/;
const supportedTypes = new Set(['string', 'text', 'integer', 'number', 'decimal', 'boolean', 'date', 'datetime', 'uuid', 'json', 'object', 'array']);

export function assertResourceKey(key) {
  if (!keyPattern.test(String(key || ''))) throw new HttpError(400, 'Resource keys must use lowercase letters, numbers, and underscores.', 'invalid_resource_key');
  return key;
}

function normalizeColumn(column, index) {
  const name = String(column?.name || '').trim();
  if (!keyPattern.test(name)) throw new HttpError(400, `Column ${index + 1} has an invalid name.`, 'invalid_resource_column');
  const type = column.type || 'string';
  if (!supportedTypes.has(type)) throw new HttpError(400, `Column ${name} has an unsupported type: ${type}.`, 'invalid_resource_column_type');
  return {
    name,
    label: column.label || name,
    type,
    required: Boolean(column.required),
    nullable: column.nullable !== false,
    unique: Boolean(column.unique),
    default: column.default,
    indexed: Boolean(column.indexed),
    enum: Array.isArray(column.enum) ? column.enum : undefined
  };
}

export function normalizeResourceSchema(input = {}) {
  const columns = Array.isArray(input) ? input : Array.isArray(input.columns) ? input.columns : Object.entries(input.properties || {}).map(([name, definition]) => ({name, ...definition}));
  const normalized = columns.map(normalizeColumn);
  const names = new Set();
  for (const column of normalized) {
    if (names.has(column.name)) throw new HttpError(400, `Duplicate resource column: ${column.name}`, 'duplicate_resource_column');
    names.add(column.name);
  }
  return {
    columns: normalized,
    allowUnknown: Boolean(input.allowUnknown),
    primaryKey: input.primaryKey || 'id',
    indexes: Array.isArray(input.indexes) ? input.indexes : []
  };
}

function validType(value, type) {
  if (value === null || value === undefined) return true;
  if (type === 'string' || type === 'text' || type === 'date' || type === 'datetime' || type === 'uuid' || type === 'decimal') return typeof value === 'string';
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value);
  if (type === 'object' || type === 'json') return typeof value === 'object' && !Array.isArray(value);
  return true;
}

export function validateResourceData(schema, input = {}, {partial = false} = {}) {
  const data = {...input};
  const columns = schema?.columns || [];
  const known = new Set(columns.map(column => column.name));
  if (!schema?.allowUnknown) {
    const unknown = Object.keys(data).filter(key => !known.has(key) && key !== 'id');
    if (unknown.length) throw new HttpError(400, `Unknown resource columns: ${unknown.join(', ')}`, 'unknown_resource_column');
  }
  for (const column of columns) {
    if (data[column.name] === undefined && !partial && column.default !== undefined) data[column.name] = typeof column.default === 'function' ? column.default() : column.default;
    if (data[column.name] === undefined) {
      if (!partial && column.required) throw new HttpError(400, `Missing required resource column: ${column.name}`, 'missing_resource_column');
      continue;
    }
    if (data[column.name] === null && column.nullable === false) throw new HttpError(400, `Resource column cannot be null: ${column.name}`, 'null_resource_column');
    if (!validType(data[column.name], column.type)) throw new HttpError(400, `Resource column has the wrong type: ${column.name}`, 'invalid_resource_value');
    if (column.enum && data[column.name] !== null && !column.enum.includes(data[column.name])) throw new HttpError(400, `Resource column is outside its allowed values: ${column.name}`, 'invalid_resource_value');
  }
  return data;
}
