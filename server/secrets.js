import crypto from 'node:crypto';
import {config} from './config.js';
import {query} from './db.js';

const algorithm = 'aes-256-gcm';

function key() {
  return crypto.createHash('sha256').update(config.providerEncryptionKey).digest();
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(value) {
  if (!value) return undefined;
  const [iv, tag, encrypted] = String(value).split('.');
  const decipher = crypto.createDecipheriv(algorithm, key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8'));
}

export async function saveConnectorSecret({tenantId, universeId, serviceType, connectorKey, value, actorId}) {
  if (value === undefined || value === null) return;
  await query(`insert into provider_secrets (tenant_id,universe_id,service_type,connector_key,ciphertext,updated_by) values ($1,$2,$3,$4,$5,$6) on conflict (tenant_id,universe_id,service_type,connector_key) do update set ciphertext = excluded.ciphertext,updated_by = excluded.updated_by,version = provider_secrets.version + 1,updated_at = now()`, [tenantId, universeId, serviceType, connectorKey, encryptSecret(value), actorId]);
}

export async function loadConnectorSecret(connector) {
  if (connector.secret_ref?.startsWith('env:')) return process.env[connector.secret_ref.slice(4)];
  if (connector.secret_ref !== 'database') return connector.secret_ref ? process.env[connector.secret_ref] : undefined;
  const result = await query(`select ciphertext from provider_secrets where tenant_id = $1 and universe_id is not distinct from $2 and service_type = $3 and connector_key = $4`, [connector.tenant_id, connector.universe_id, connector.service_type, connector.connector_key]);
  return result.rowCount ? decryptSecret(result.rows[0].ciphertext) : undefined;
}
