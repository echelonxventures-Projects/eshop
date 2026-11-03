import {query, withTenant} from './db.js';
import {HttpError} from './http.js';

export async function resolveModule(context, moduleKey) {
  const result = await query(`select * from module_definitions where tenant_id = $1 and module_key = $2 and enabled = true and (universe_id = $3 or universe_id is null) and effective_from <= now() and (effective_until is null or effective_until > now()) order by case when universe_id = $3 then 0 else 1 end, version desc limit 1`, [context.tenantId, moduleKey, context.universeId]);
  if (!result.rowCount) throw new HttpError(404, `Module is not configured: ${moduleKey}`, 'module_not_configured');
  return result.rows[0];
}

export function assertCapability(module, capability) {
  if (module.capabilities?.[capability] !== true) throw new HttpError(403, `Module capability is not enabled: ${capability}`, 'module_capability_disabled');
}

export async function convert(context, moduleKey, amount, fromUnit, toUnit) {
  const module = await resolveModule(context, moduleKey);
  assertCapability(module, 'conversion');
  if (fromUnit === toUnit) return {amount:Number(amount), fromUnit, toUnit, rate:1, fee:0, moduleKey};
  const result = await query(`select rate,fee,rounding_mode as "roundingMode",decimal_places as "decimalPlaces" from conversion_rules where tenant_id = $1 and module_key = $2 and from_unit = $3 and to_unit = $4 and (universe_id = $5 or universe_id is null) and effective_from <= now() and (effective_until is null or effective_until > now()) order by case when universe_id = $5 then 0 else 1 end,effective_from desc limit 1`, [context.tenantId, moduleKey, fromUnit, toUnit, context.universeId]);
  if (!result.rowCount) throw new HttpError(422, `No conversion rule is configured for ${fromUnit} to ${toUnit}`, 'conversion_rule_not_found');
  const rule = result.rows[0];
  const converted = (Number(amount) * Number(rule.rate)) - Number(rule.fee);
  const decimals = Number(rule.decimalPlaces);
  return {amount:Number(converted.toFixed(decimals)),fromUnit,toUnit,rate:Number(rule.rate),fee:Number(rule.fee),roundingMode:rule.roundingMode,moduleKey};
}

export async function createAccount(context, owner, moduleKey, input) {
  const module = await resolveModule(context, moduleKey);
  assertCapability(module, 'accounts');
  if (!input.unit) throw new HttpError(400, 'Account unit is required', 'validation_error');
  if (Array.isArray(module.units) && module.units.length && !module.units.includes(input.unit)) throw new HttpError(422, `Unit is not enabled for module ${moduleKey}`, 'unit_not_enabled');
  const result = await query(`insert into value_accounts (tenant_id,universe_id,module_key,owner_type,owner_id,unit,display_name) values ($1,$2,$3,$4,$5,$6,$7) on conflict (tenant_id,universe_id,module_key,owner_type,owner_id,unit) do update set display_name = coalesce(excluded.display_name,value_accounts.display_name) returning id,module_key as "moduleKey",owner_type as "ownerType",owner_id as "ownerId",unit,display_name as "displayName",status,available,held,version,created_at as "createdAt"`, [context.tenantId, context.universeId, moduleKey, owner.type, owner.id, input.unit, input.displayName || null]);
  return result.rows[0];
}

export async function getAccounts(context, owner, moduleKey) {
  const module = await resolveModule(context, moduleKey);
  assertCapability(module, 'accounts');
  const result = await query(`select id,module_key as "moduleKey",owner_type as "ownerType",owner_id as "ownerId",unit,display_name as "displayName",status,available,held,version,created_at as "createdAt" from value_accounts where tenant_id = $1 and universe_id = $2 and module_key = $3 and owner_type = $4 and owner_id = $5 order by created_at`, [context.tenantId, context.universeId, moduleKey, owner.type, owner.id]);
  return result.rows;
}

export async function postEntry(context, owner, moduleKey, accountId, input, idempotencyKey) {
  const module = await resolveModule(context, moduleKey);
  assertCapability(module, 'ledger');
  if (!idempotencyKey) throw new HttpError(400, 'Idempotency-Key header is required', 'idempotency_required');
  if (!input.amount || Number(input.amount) <= 0 || !input.direction) throw new HttpError(400, 'Ledger amount and direction are required', 'validation_error');
  return withTenant(context.tenantId, async client => {
    const account = await client.query(`select id,unit,status,available,version from value_accounts where id = $1 and tenant_id = $2 and universe_id = $3 and module_key = $4 and owner_type = $5 and owner_id = $6 for update`, [accountId, context.tenantId, context.universeId, moduleKey, owner.type, owner.id]);
    if (!account.rowCount) throw new HttpError(404, 'Value account was not found', 'account_not_found');
    const current = account.rows[0];
    if (current.status !== 'active') throw new HttpError(409, 'Value account is not active', 'account_not_active');
    const prior = await client.query(`select id,balance_after as "balanceAfter",amount,unit,direction from value_ledger_entries where tenant_id = $1 and module_key = $2 and account_id = $3 and idempotency_key = $4`, [context.tenantId, moduleKey, accountId, idempotencyKey]);
    if (prior.rowCount) return prior.rows[0];
    const amount = Number(input.amount);
    const next = input.direction === 'credit' ? Number(current.available) + amount : Number(current.available) - amount;
    if (next < 0) throw new HttpError(422, 'Insufficient account balance', 'insufficient_balance');
    await client.query(`update value_accounts set available = $1,version = version + 1 where id = $2`, [next, accountId]);
    const entry = await client.query(`insert into value_ledger_entries (tenant_id,universe_id,module_key,account_id,entry_type,direction,amount,unit,balance_after,reference_type,reference_id,idempotency_key,metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id,module_key as "moduleKey",account_id as "accountId",entry_type as "entryType",direction,amount,unit,balance_after as "balanceAfter",reference_type as "referenceType",reference_id as "referenceId",created_at as "createdAt"`, [context.tenantId, context.universeId, moduleKey, accountId, input.entryType || 'adjustment', input.direction, amount, current.unit, next, input.referenceType || null, input.referenceId || null, idempotencyKey, input.metadata || {}]);
    return entry.rows[0];
  });
}
