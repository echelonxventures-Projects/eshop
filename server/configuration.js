import {repositories} from './db.js';
import {manifestDefault} from './runtime-config.js';

const scopeOrder = ['platform', 'tenant', 'universe', 'country', 'region', 'channel', 'user'];

function merge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  const result = {...(base && typeof base === 'object' && !Array.isArray(base) ? base : {})};
  for (const [key, value] of Object.entries(override)) result[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(result[key], value) : value;
  return result;
}

export async function resolveConfiguration(context, namespace, key, fallback = {}) {
  const result = await repositories.configuration.resolveConfiguration(context, namespace, key, scopeOrder);
  let resolved = fallback;
  for (const item of result.rows) resolved = merge(resolved, item.value);
  return resolved;
}

export function manifestConfiguration(namespace, key, fallback = {}) {
  return manifestDefault(namespace, key, fallback);
}
