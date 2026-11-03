import pg from 'pg';
import {assertStorageAdapter} from './contract.js';
import {normalizeCapabilities} from './capabilities.js';
import {assertResourceKey, normalizeResourceSchema, validateResourceData} from './resource-schema.js';
import {createPostgresRepositories} from './postgres-repositories.js';

export function createStorageAdapter(config) {
  const {Pool} = pg;
  const pool = new Pool({connectionString:config.databaseUrl,max:Number(process.env.DB_POOL_MAX || 20),idleTimeoutMillis:30000,connectionTimeoutMillis:5000,ssl:process.env.DATABASE_SSL === 'true' ? {rejectUnauthorized:false} : undefined});
  const sql = (text, params = []) => pool.query(text, params);
  const transaction = async (callback, context = {}) => { const client = await pool.connect(); try { await client.query('BEGIN'); if (context.tenantId) await client.query('select set_config(\'app.tenant_id\',$1,true)', [context.tenantId]); const value = await callback(client); await client.query('COMMIT'); return value; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } };
  const resourceContext = context => ({tenantId:context?.tenantId, universeId:context?.universeId || 'default'});
  const resourceStore = {
    model:'relational',
    async listDefinitions(context) {
      const scope = resourceContext(context); const result = await sql(`select id,tenant_id as "tenantId",universe_id as "universeId",resource_key as "resourceKey",display_name as "displayName",storage_model as "storageModel",schema,options,status,version,created_at as "createdAt",updated_at as "updatedAt" from resource_definitions where tenant_id = $1 and universe_id = $2 and status = 'active' order by resource_key`, [scope.tenantId, scope.universeId]); return result.rows;
    },
    async getDefinition(context, key) {
      assertResourceKey(key); const scope = resourceContext(context); const result = await sql(`select id,tenant_id as "tenantId",universe_id as "universeId",resource_key as "resourceKey",display_name as "displayName",storage_model as "storageModel",schema,options,status,version,created_at as "createdAt",updated_at as "updatedAt" from resource_definitions where tenant_id = $1 and universe_id = $2 and resource_key = $3 and status = 'active'`, [scope.tenantId, scope.universeId, key]); return result.rows[0] || null;
    },
    async define(context, key, input = {}) {
      assertResourceKey(key); const scope = resourceContext(context); const schema = normalizeResourceSchema(input.schema || input.columns || {});
      const result = await sql(`insert into resource_definitions (tenant_id,universe_id,resource_key,display_name,storage_model,schema,options,status) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (tenant_id,universe_id,resource_key) do update set display_name = excluded.display_name,storage_model = excluded.storage_model,schema = excluded.schema,options = excluded.options,status = excluded.status,version = resource_definitions.version + 1,updated_at = now() returning id,tenant_id as "tenantId",universe_id as "universeId",resource_key as "resourceKey",display_name as "displayName",storage_model as "storageModel",schema,options,status,version,created_at as "createdAt",updated_at as "updatedAt"`, [scope.tenantId, input.universeId || scope.universeId, key, input.displayName || key, input.storageModel || 'relational', schema, input.options || {}, input.status || 'active']);
      return result.rows[0];
    },
    async listRecords(context, key, options = {}) {
      const definition = await resourceStore.getDefinition(context, key); if (!definition) return {data:[],total:0,definition:null}; const scope = resourceContext(context); const pageSize = Math.min(1000, Math.max(1, Number(options.pageSize || 100))); const page = Math.max(1, Number(options.page || 1));
      const values = [scope.tenantId, scope.universeId, key]; const filter = options.filter && typeof options.filter === 'object' ? Object.entries(options.filter) : []; const where = filter.map(([field, value], index) => {values.push(field, value); return `data ->> $${index * 2 + 4} = $${index * 2 + 5}`;}); const limitPosition = values.length + 1; values.push(pageSize, (page - 1) * pageSize);
      const result = await sql(`select id,external_key as "externalKey",data,version,status,created_by as "createdBy",created_at as "createdAt",updated_at as "updatedAt" from resource_records where tenant_id = $1 and universe_id = $2 and resource_key = $3 and status = 'active' ${where.length ? `and ${where.join(' and ')}` : ''} order by updated_at desc limit $${limitPosition} offset $${limitPosition + 1}`, values);
      const count = await sql(`select count(*)::int as count from resource_records where tenant_id = $1 and universe_id = $2 and resource_key = $3 and status = 'active'`, [scope.tenantId, scope.universeId, key]); return {data:result.rows,total:count.rows[0].count,definition};
    },
    async getRecord(context, key, id) { const scope = resourceContext(context); const result = await sql(`select id,external_key as "externalKey",data,version,status,created_by as "createdBy",created_at as "createdAt",updated_at as "updatedAt" from resource_records where id = $1 and tenant_id = $2 and universe_id = $3 and resource_key = $4 and status = 'active'`, [id, scope.tenantId, scope.universeId, key]); return result.rows[0] || null; },
    async createRecord(context, key, input = {}, actorId = null) { const definition = await resourceStore.getDefinition(context, key); if (!definition) throw Object.assign(new Error('Resource definition was not found'), {code:'resource_not_found',status:404}); const data = validateResourceData(definition.schema, input); const scope = resourceContext(context); const result = await sql(`insert into resource_records (tenant_id,universe_id,resource_key,external_key,data,created_by) values ($1,$2,$3,$4,$5,$6) returning id,external_key as "externalKey",data,version,status,created_by as "createdBy",created_at as "createdAt",updated_at as "updatedAt"`, [scope.tenantId, scope.universeId, key, input.externalKey || null, data, actorId]); return result.rows[0]; },
    async updateRecord(context, key, id, input = {}, expectedVersion) { const current = await resourceStore.getRecord(context, key, id); if (!current) return null; if (expectedVersion !== undefined && Number(expectedVersion) !== Number(current.version)) throw Object.assign(new Error('Resource record version conflict'), {code:'resource_version_conflict',status:409}); const definition = await resourceStore.getDefinition(context, key); const data = validateResourceData(definition.schema, {...current.data, ...input}); const scope = resourceContext(context); const result = await sql(`update resource_records set data = $1,version = version + 1,updated_at = now() where id = $2 and tenant_id = $3 and universe_id = $4 and resource_key = $5 and version = $6 returning id,external_key as "externalKey",data,version,status,created_by as "createdBy",created_at as "createdAt",updated_at as "updatedAt"`, [data, id, scope.tenantId, scope.universeId, key, current.version]); if (!result.rowCount) throw Object.assign(new Error('Resource record version conflict'), {code:'resource_version_conflict',status:409}); return result.rows[0]; },
    async deleteRecord(context, key, id) { const scope = resourceContext(context); const result = await sql(`update resource_records set status = 'deleted',updated_at = now() where id = $1 and tenant_id = $2 and universe_id = $3 and resource_key = $4 and status = 'active' returning id,version,status`, [id, scope.tenantId, scope.universeId, key]); return result.rows[0] || null; },
    async link(context, input = {}) { const scope = resourceContext(context); const result = await sql(`insert into resource_links (tenant_id,universe_id,link_type,from_resource_key,from_id,to_resource_key,to_id,data) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (tenant_id,universe_id,link_type,from_id,to_id) do update set data = excluded.data returning id,link_type as type,from_resource_key as "fromResourceKey",from_id as "fromId",to_resource_key as "toResourceKey",to_id as "toId",data,created_at as "createdAt"`, [scope.tenantId, scope.universeId, input.type, input.fromResourceKey, input.fromId, input.toResourceKey, input.toId, input.data || {}]); return result.rows[0]; },
    async links(context, fromId, type) { const scope = resourceContext(context); const result = await sql(`select id,link_type as type,from_resource_key as "fromResourceKey",from_id as "fromId",to_resource_key as "toResourceKey",to_id as "toId",data,created_at as "createdAt" from resource_links where tenant_id = $1 and universe_id = $2 and from_id = $3 ${type ? 'and link_type = $4' : ''} order by created_at`, type ? [scope.tenantId, scope.universeId, fromId, type] : [scope.tenantId, scope.universeId, fromId]); return result.rows; }
  };
  const repositories = createPostgresRepositories({sql, transaction});
  return assertStorageAdapter({
    capabilities: normalizeCapabilities({transactions:true,optimisticConcurrency:true,json:true,decimal:true,fullText:true,joins:true,outbox:true,conditionalWrites:true,timeOrdering:true,relationships:true,geoSearch:false,vectorSearch:false,ttl:true,changeStreams:false}),
    repositories,
    resources:resourceStore,
    pool,
    query: (text, params = []) => pool.query(text, params),
    withTransaction:transaction,
    health: () => pool.query('select 1'),
    migrate: schema => pool.query(schema),
    close: () => pool.end()
  });
}
