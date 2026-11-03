import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {query} from './db.js';
import {config} from './config.js';
import {HttpError} from './http.js';
import {loadConnectorSecret} from './secrets.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function matches(values, value) {
  return !Array.isArray(values) || values.length === 0 || values.includes(value);
}

export async function resolveConnector(context, serviceType, connectorKey) {
  const params = [context.tenantId, serviceType, context.universeId];
  const requested = connectorKey ? `and c.connector_key = $4` : '';
  if (connectorKey) params.push(connectorKey);
  const result = await query(`select c.* from service_connectors c where c.tenant_id = $1 and c.service_type = $2 and (c.universe_id = $3 or c.universe_id is null) and c.enabled = true and c.effective_from <= now() and (c.effective_until is null or c.effective_until > now()) ${requested} order by case when c.universe_id = $3 then 0 else 1 end, c.priority asc, c.created_at asc`, params);
  const connector = result.rows.find(item => matches(item.regions, context.region) && matches(item.country_codes, context.countryCode) && matches(item.currencies, context.currency) && matches(item.locales, context.locale) && matches(item.channels, context.channel || 'web'));
  if (!connector) throw new HttpError(503, connectorKey ? `The requested ${serviceType} connector is not available for this context` : `No ${serviceType} connector is configured for this context`, 'connector_unavailable', {serviceType, tenantId:context.tenantId, universeId:context.universeId, region:context.region, countryCode:context.countryCode, currency:context.currency, locale:context.locale});
  return connector;
}

export async function loadConnectorAdapter(adapterModule) {
  if (!adapterModule || adapterModule.includes('..') || adapterModule.startsWith('/') || adapterModule.startsWith('\\')) throw new HttpError(500, 'Connector adapter configuration is invalid', 'invalid_adapter_configuration');
  if (adapterModule.startsWith('@') || /^[a-zA-Z0-9_-]+$/.test(adapterModule)) {
    try { return await import(adapterModule); } catch (error) { throw new HttpError(503, `Configured connector package could not be loaded: ${error.message}`, 'adapter_unavailable'); }
  }
  const adapterRoot = path.resolve(projectRoot, config.adapterRoot);
  const adapterPath = path.resolve(adapterRoot, adapterModule);
  if (!adapterPath.startsWith(`${adapterRoot}${path.sep}`)) throw new HttpError(500, 'Connector adapter is outside the configured adapter directory', 'invalid_adapter_configuration');
  try { return await import(pathToFileURL(adapterPath).href); } catch (error) { throw new HttpError(503, `Configured connector adapter could not be loaded: ${error.message}`, 'adapter_unavailable'); }
}

export async function executeConnector({connector, operation, context, payload}) {
  const configuredOperations = connector.capabilities?.operations;
  if (Array.isArray(configuredOperations) && !configuredOperations.includes(operation)) throw new HttpError(403, `Connector operation is not enabled: ${operation}`, 'connector_operation_disabled');
  const adapter = await loadConnectorAdapter(connector.adapter_module);
  if (typeof adapter[operation] !== 'function') throw new HttpError(500, `Connector does not implement operation: ${operation}`, 'unsupported_connector_operation');
  const secret = await loadConnectorSecret(connector);
  return adapter[operation]({connector:{id:connector.id,key:connector.connector_key,serviceType:connector.service_type,config:connector.config,capabilities:connector.capabilities,secret}, context, payload});
}
