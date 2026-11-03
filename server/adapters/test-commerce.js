import crypto from 'node:crypto';

export async function getQuotes({connector, context, payload}) {
  const config = connector.config || {};
  const threshold = Number(config.freeShippingThreshold ?? 35);
  const fee = Number(config.defaultShippingFee ?? 5.99);
  const subtotal = Number(payload.subtotal || 0);
  return {quotes:[{id:'standard',label:config.label || 'Standard delivery',amount:subtotal >= threshold ? 0 : fee,currency:context.currency,promise:config.promise || '3–5 business days'}]};
}

export async function calculateTax({connector, context, payload}) {
  const config = connector.config || {};
  const rate = Number(config.taxRate ?? 0);
  const amount = Number((Number(payload.subtotal || 0) * rate).toFixed(2));
  return {amount,currency:context.currency,rate,jurisdiction:payload.shippingAddress?.country || context.countryCode};
}

export async function createShipment({connector, context, payload}) {
  return {shipmentId:crypto.randomUUID(),carrier:connector.config?.carrier || 'Configured carrier',status:'label_created',trackingNumber:`TEST-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,currency:context.currency,metadata:{test:true,orderId:payload.order?.id}};
}
