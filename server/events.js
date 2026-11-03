import crypto from 'node:crypto';
import {repositories} from './db.js';
import {HttpError} from './http.js';

export function eventEnvelope({type, source, subject, data, context, correlationId, causationId, eventId = crypto.randomUUID()}) {
  if (!type || !source) throw new HttpError(400, 'Event type and source are required', 'event_validation_error');
  return {specversion:'1.0',id:eventId,type,source,subject:subject || null,time:new Date().toISOString(),datacontenttype:'application/json',tenantId:context.tenantId,universeId:context.universeId,data:data || {},correlationId:correlationId || null,causationId:causationId || null};
}

export async function publishEvent({type, source, subject, data, context, correlationId, causationId, eventId}) {
  const event = eventEnvelope({type, source, subject, data, context, correlationId, causationId, eventId});
  const result = await repositories.events.publishEvent({context,type:event.type,source:event.source,subject:event.subject,time:event.time,dataContentType:event.datacontenttype,data:event.data,correlationId:event.correlationId,causationId:event.causationId,eventId:event.id});
  if (!result.rowCount) throw new HttpError(409, 'Event ID has already been published', 'event_id_exists');
  return {...result.rows[0], envelope:event};
}
