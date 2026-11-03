import {Connection, Client} from '@temporalio/client';
import {config} from '../config.js';
import {closeDb, query, withTransaction} from '../db.js';
import {resolveWorkflow} from '../registry.js';
import {manifestDefault} from '../runtime-config.js';

async function claimEvent() {
  return withTransaction(async client => {
    const result = await client.query(`select id, tenant_id, universe_id, event_type, aggregate_type, aggregate_id, payload from outbox_events where status = 'pending' and available_at <= now() order by created_at for update skip locked limit 1`);
    if (!result.rowCount) return null;
    const event = result.rows[0];
    await client.query(`update outbox_events set status = 'processing', attempts = attempts + 1 where id = $1`, [event.id]);
    return event;
  });
}

async function markPublished(eventId) {
  await query(`update outbox_events set status = 'published', processed_at = now() where id = $1`, [eventId]);
}

async function markFailed(eventId, error) {
  const policy = manifestDefault('outbox', 'retry', {});
  await query(`update outbox_events set status = case when attempts >= $2 then 'failed' else 'pending' end, available_at = now() + ($3 * interval '1 second'), last_error = $4 where id = $1`, [eventId, Number(policy.maxAttempts), Number(policy.retryDelaySeconds), error.message.slice(0, Number(policy.maxErrorLength))]);
}

async function main() {
  if (!config.temporalAddress) throw new Error('TEMPORAL_ADDRESS is required to run the outbox worker');
  const connection = await Connection.connect({address:config.temporalAddress});
  const temporal = new Client({connection, namespace:config.temporalNamespace});
  console.log(`Outbox dispatcher connected to Temporal at ${config.temporalAddress}`);
  while (true) {
    const event = await claimEvent();
    if (!event) { await new Promise(resolve => setTimeout(resolve, config.outboxPollMs)); continue; }
    try {
      const definition = await resolveWorkflow({tenantId:event.tenant_id, universeId:event.universe_id}, event.event_type);
      if (!definition) {
        await markPublished(event.id);
        continue;
      }
      await temporal.workflow.start(definition.workflow_type, {workflowId:`${event.tenant_id}:${event.aggregate_type}:${event.aggregate_id}:${event.id}`, taskQueue:definition.task_queue || config.temporalTaskQueue, args:[{...event.payload, eventId:event.id, tenantId:event.tenant_id, universeId:event.universe_id, eventType:event.event_type, workflowKey:definition.workflow_key}]});
      await markPublished(event.id);
    } catch (error) {
      console.error(`Outbox event ${event.id} failed:`, error.message);
      await markFailed(event.id, error);
    }
  }
}

main().catch(async error => { console.error(error); await closeDb(); process.exitCode = 1; });
