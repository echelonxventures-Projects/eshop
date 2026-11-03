import {capabilities, query} from './db.js';

export async function resolveTopology(context) {
  if (!capabilities.joins) return null;
  const result = await query(`select r.shard_key as "shardKey",p.plane_key as "planeKey",p.adapter_module as "adapterModule",p.endpoint_secret_ref as "endpointSecretRef",p.topology,p.capacity from tenant_data_routes r join data_planes p on p.id = r.data_plane_id where r.tenant_id = $1 and (r.universe_id = $2 or r.universe_id is null) and p.status = 'active' and r.effective_from <= now() and (r.effective_until is null or r.effective_until > now()) order by case when r.universe_id = $2 then 0 else 1 end, r.weight desc limit 1`, [context.tenantId, context.universeId]);
  return result.rows[0] || null;
}
