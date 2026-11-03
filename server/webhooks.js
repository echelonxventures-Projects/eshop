import crypto from 'node:crypto';
import {loadConnectorSecret} from './secrets.js';
import {publishEvent} from './events.js';
import {HttpError} from './http.js';
import {recordWebhook} from './observability.js';

function secretValue(secret) { return typeof secret === 'string' ? secret : secret?.webhookSecret || secret?.signingSecret || secret?.apiKey || secret?.token || secret?.value; }

function verifySignature(rawBody, signature, secret, algorithm = 'sha256') {
  if (!signature || !secret) return false;
  const supplied = signature.replace(/^sha\d+=/, '');
  const expected = crypto.createHmac(algorithm, secret).update(rawBody).digest('hex');
  const left = Buffer.from(supplied, 'utf8'); const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function acceptWebhook({connector, context, req}) {
  const webhook = connector.config?.webhook || {};
  const secret = secretValue(await loadConnectorSecret(connector));
  const signatureHeader = webhook.signatureHeader || 'x-signature';
  if (webhook.requireSignature !== false && !verifySignature(req.rawBody || Buffer.from(JSON.stringify(req.body || {})), req.get(signatureHeader), secret, webhook.signatureAlgorithm || 'sha256')) {
    recordWebhook(connector.service_type, 'invalid_signature');
    throw new HttpError(401, 'Webhook signature is invalid', 'invalid_webhook_signature');
  }
  const eventId = req.get(webhook.eventHeader || 'x-event-id') || req.body?.id || crypto.createHash('sha256').update(req.rawBody || JSON.stringify(req.body || {})).digest('hex');
  const eventType = req.get(webhook.typeHeader || 'x-event-type') || req.body?.type || `${connector.service_type}.webhook`;
  try {
    const published = await publishEvent({eventId, type:eventType, source:`provider:${connector.connector_key}`, subject:req.body?.subject || null, data:{connectorKey:connector.connector_key, payload:req.body}, context});
    recordWebhook(connector.service_type, published?.envelope ? 'accepted' : 'duplicate');
    return {eventId,eventType,duplicate:false};
  } catch (error) {
    if (error.code === 'event_id_exists') { recordWebhook(connector.service_type, 'duplicate'); return {eventId,eventType,duplicate:true}; }
    recordWebhook(connector.service_type, 'failed'); throw error;
  }
}
