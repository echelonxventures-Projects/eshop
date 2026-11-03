import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {query} from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, '..', 'platform-config.json'), 'utf8'));

export async function getRuntimeConfig(context, namespace, key, fallback = {}) {
  const result = await query(`select value from runtime_config where tenant_id = $1 and universe_id = $2 and namespace = $3 and config_key = $4 and effective_from <= now() and (effective_until is null or effective_until > now())`, [context.tenantId, context.universeId, namespace, key]);
  return result.rowCount ? result.rows[0].value : fallback;
}

export function manifestDefault(namespace, key, fallback = {}) {
  return manifest.defaults?.[namespace]?.[key] ?? fallback;
}

export function publicRuntimeConfig() { return manifest.defaults || {}; }
