import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertStorageAdapter} from './contract.js';
import {assertRepositories, repositoryContract} from './repositories.js';
import {normalizeCapabilities} from './capabilities.js';
import {assertResourceKey, normalizeResourceSchema, validateResourceData} from './resource-schema.js';

const emptyState = () => ({version:1, resources:[], records:{}, links:[], users:[], memberships:[], refreshTokens:[], migrations:[], tenants:[{id:'us',region:'NA',countryCode:'US',currency:'USD',universes:['consumer','business']}]});
const result = rows => ({rows, rowCount:rows.length});
const unsupported = method => async () => { throw Object.assign(new Error(`Repository operation is not implemented by this storage model: ${method}`), {code:'storage_capability_unavailable', status:501}); };
const clone = value => structuredClone(value);

export async function createJsonStorageAdapter(config, {model = 'document', fileName = 'storage.json', capabilities = {}} = {}) {
  const filePath = config.storageFilePath || path.resolve(process.cwd(), '.marketly-storage', fileName);
  await fs.mkdir(path.dirname(filePath), {recursive:true});
  let state;
  try { state = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; state = emptyState(); }
  state = {...emptyState(), ...state};
  if (config.nodeEnv !== 'production' && !state.users.length) {
    const passwordHash = '$2b$10$wcApNq5he3YESgnaN.W7x.fsurdTeN5eZLtYHgMr/WhKP2YDzuT4e';
    for (const [email, role, firstName] of [['customer.demo@marketly.local','customer','Demo'],['seller.demo@marketly.local','seller','Demo'],['support.demo@marketly.local','support','Demo'],['admin.demo@marketly.local','admin','Demo'],['owner.demo@marketly.local','owner','Demo']]) {
      const id = crypto.randomUUID(); state.users.push({id,email,password_hash:passwordHash,first_name:firstName,last_name:'Demo',role,status:'active'}); state.memberships.push({tenantId:'us',userId:id,role});
    }
    await fs.writeFile(filePath, JSON.stringify(state, null, 2));
  }
  const persist = async () => {
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2));
    await fs.rename(temporary, filePath);
  };
  let writeQueue = Promise.resolve();
  const save = async () => { writeQueue = writeQueue.then(persist); return writeQueue; };
  const scoped = (context = {}) => ({tenantId:context.tenantId || 'platform', universeId:context.universeId || null});
  const findDefinition = (context, key) => {
    const scope = scoped(context);
    const matches = state.resources.filter(item => item.resourceKey === key && item.tenantId === scope.tenantId && (item.universeId === scope.universeId || item.universeId === null));
    return matches.sort((a, b) => Number(b.universeId === scope.universeId) - Number(a.universeId === scope.universeId) || b.version - a.version)[0];
  };
  const resourceStore = {
    model,
    async listDefinitions(context = {}) {
      const scope = scoped(context);
      return state.resources.filter(item => item.tenantId === scope.tenantId && (item.universeId === scope.universeId || item.universeId === null));
    },
    async getDefinition(context, key) { assertResourceKey(key); return findDefinition(context, key) || null; },
    async define(context, key, input = {}) {
      assertResourceKey(key);
      const scope = scoped(context);
      const schema = normalizeResourceSchema(input.schema || input.columns || {});
      const current = state.resources.find(item => item.tenantId === scope.tenantId && item.universeId === (input.universeId ?? scope.universeId) && item.resourceKey === key);
      const definition = {id:current?.id || crypto.randomUUID(), tenantId:scope.tenantId, universeId:input.universeId ?? scope.universeId, resourceKey:key, displayName:input.displayName || key, storageModel:input.storageModel || model, schema, options:input.options || {}, status:input.status || 'active', version:(current?.version || 0) + 1, updatedAt:new Date().toISOString()};
      if (current) Object.assign(current, definition); else state.resources.push(definition);
      await save();
      return definition;
    },
    async listRecords(context, key, options = {}) {
      const definition = findDefinition(context, key); if (!definition) return {data:[], total:0, definition:null};
      const scope = scoped(context); let rows = (state.records[key] || []).filter(item => item.tenantId === scope.tenantId && (item.universeId === scope.universeId || item.universeId === null) && item.status !== 'deleted');
      if (options.filter && typeof options.filter === 'object') rows = rows.filter(row => Object.entries(options.filter).every(([field, value]) => row.data?.[field] === value));
      rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      const pageSize = Math.min(1000, Math.max(1, Number(options.pageSize || 100))); const page = Math.max(1, Number(options.page || 1));
      return {data:rows.slice((page - 1) * pageSize, page * pageSize), total:rows.length, definition};
    },
    async getRecord(context, key, id) { const definition = findDefinition(context, key); const scope = scoped(context); return (state.records[key] || []).find(item => item.id === id && item.tenantId === scope.tenantId && (item.universeId === scope.universeId || item.universeId === null) && item.status !== 'deleted') || null; },
    async createRecord(context, key, input = {}, actorId = null) {
      const definition = findDefinition(context, key); if (!definition) throw Object.assign(new Error('Resource definition was not found'), {code:'resource_not_found', status:404});
      const data = validateResourceData(definition.schema, input); const scope = scoped(context); const now = new Date().toISOString();
      const record = {id:crypto.randomUUID(), tenantId:scope.tenantId, universeId:scope.universeId, resourceKey:key, externalKey:input.externalKey || null, data, status:'active', version:1, createdBy:actorId, createdAt:now, updatedAt:now};
      if (!state.records[key]) state.records[key] = []; state.records[key].push(record); await save(); return record;
    },
    async updateRecord(context, key, id, input = {}, expectedVersion) {
      const current = await resourceStore.getRecord(context, key, id); if (!current) return null;
      if (expectedVersion !== undefined && Number(expectedVersion) !== current.version) throw Object.assign(new Error('Resource record version conflict'), {code:'resource_version_conflict', status:409});
      const definition = findDefinition(context, key); current.data = validateResourceData(definition.schema, {...current.data, ...input}, {partial:false}); current.version += 1; current.updatedAt = new Date().toISOString(); await save(); return current;
    },
    async deleteRecord(context, key, id) { const current = await resourceStore.getRecord(context, key, id); if (!current) return null; current.status = 'deleted'; current.updatedAt = new Date().toISOString(); await save(); return current; },
    async link(context, input = {}) { const scope = scoped(context); const link = {...input, id:input.id || crypto.randomUUID(), tenantId:scope.tenantId, universeId:scope.universeId, createdAt:new Date().toISOString()}; const existing = state.links.find(item => item.tenantId === link.tenantId && item.type === link.type && item.fromId === link.fromId && item.toId === link.toId); if (existing) Object.assign(existing, link); else state.links.push(link); await save(); return link; },
    async links(context, fromId, type) { const scope = scoped(context); return state.links.filter(item => item.tenantId === scope.tenantId && item.fromId === fromId && (!type || item.type === type)); }
  };
  const repositories = {
    identity: {
      findUserByEmail: async (email, tenantId) => result(state.users.filter(user => user.email.toLowerCase() === email.toLowerCase() && state.memberships.some(member => member.tenantId === tenantId && member.userId === user.id) && user.status === 'active')),
      createUser: async input => { const user = {id:crypto.randomUUID(), email:input.email.toLowerCase(), password_hash:input.passwordHash, first_name:input.firstName || null, last_name:input.lastName || null, role:'customer', status:'active'}; state.users.push(user); await save(); return result([user]); },
      addMembership: async input => { state.memberships.push({tenantId:input.tenantId,userId:input.userId,role:'customer'}); await save(); return result([]); },
      findRefreshToken: async (tokenHash, tenantId) => { const token = state.refreshTokens.find(item => item.tokenHash === tokenHash && item.tenantId === tenantId && !item.revokedAt && new Date(item.expiresAt) > new Date()); const user = token && state.users.find(item => item.id === token.userId); return result(token && user ? [{id:token.id,user_id:user.id,email:user.email,role:(state.memberships.find(item => item.tenantId === tenantId && item.userId === user.id)?.role || user.role),status:user.status}] : []); },
      storeRefreshToken: async input => { state.refreshTokens.push({id:crypto.randomUUID(),userId:input.userId,tenantId:input.tenantId,tokenHash:input.tokenHash,expiresAt:input.expiresAt}); await save(); return result([]); },
      revokeRefreshToken: async id => { const token = state.refreshTokens.find(item => item.id === id); if (token) token.revokedAt = new Date().toISOString(); await save(); return result([]); }
    },
    context: {resolveTenantContext: async (tenantId, universeId) => result(state.tenants?.filter(item => item.id === tenantId && item.universes?.includes(universeId)).map(item => ({tenant_id:item.id,region:item.region,country_code:item.countryCode,default_currency:item.currency,universe_id:universeId})) || [])},
    configuration: {resolveConfiguration:unsupported('configuration.resolveConfiguration'),readRuntimeConfig:unsupported('configuration.readRuntimeConfig'),writeRuntimeConfig:unsupported('configuration.writeRuntimeConfig')},
    registry:Object.fromEntries(repositoryContract.registry.map(method => [method, unsupported(`registry.${method}`)])),
    catalog:Object.fromEntries(repositoryContract.catalog.map(method => [method, unsupported(`catalog.${method}`)])),
    commerce:Object.fromEntries(repositoryContract.commerce.map(method => [method, unsupported(`commerce.${method}`)])),
    events:Object.fromEntries(repositoryContract.events.map(method => [method, unsupported(`events.${method}`)]))
  };
  return assertStorageAdapter({
    model,
    capabilities:normalizeCapabilities(capabilities),
    repositories:assertRepositories(repositories),
    resources:resourceStore,
    query:async () => { throw Object.assign(new Error('Legacy query execution is unavailable for this storage model; use semantic repositories or resources.'), {code:'storage_capability_unavailable', status:501}); },
    withTransaction:async callback => callback({query:async () => { throw Object.assign(new Error('This storage model does not expose a SQL transaction client.'), {code:'storage_capability_unavailable', status:501}); }}),
    health:async () => ({ok:true, model, filePath}),
    migrate:async manifest => { state.migrations.push({model, appliedAt:new Date().toISOString(), fingerprint:crypto.createHash('sha256').update(String(manifest || '')).digest('hex')}); await save(); },
    close:save
  });
}
