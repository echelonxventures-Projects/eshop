import {HttpError} from './http.js';
import {repositories} from './db.js';
import {resolveTopology} from './topology.js';
import {manifestDefault} from './runtime-config.js';

export async function resolveContext(req, _res, next) {
  try {
    const defaults = manifestDefault('context', 'context', {});
    const tenantId = req.header('x-tenant-id') || defaults.tenant;
    const universeId = req.header('x-universe-id') || defaults.universe;
    const locale = req.header('x-locale') || defaults.locale;
    const currency = req.header('x-currency') || defaults.currency;
    const channel = req.header('x-channel') || defaults.channel;
    const result = await repositories.context.resolveTenantContext(tenantId, universeId);
    if (!result.rowCount) throw new HttpError(404, 'Tenant or universe was not found', 'context_not_found');
    req.context = {tenantId, universeId, region:result.rows[0].region, countryCode:result.rows[0].country_code, locale, currency, channel, topology:await resolveTopology({tenantId, universeId})};
    next();
  } catch (error) { next(error); }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'This action requires additional permissions', 'forbidden'));
    next();
  };
}
