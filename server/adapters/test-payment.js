import crypto from 'node:crypto';

export async function createIntent({connector, payload}) {
  const order = payload.order;
  return {providerIntentId:`${connector.key}_${crypto.randomUUID()}`, status:'requires_payment_method', clientSecret:`test_${crypto.randomBytes(18).toString('hex')}`, metadata:{test:true,amount:order.total,currency:order.currency}};
}

export async function confirmIntent({payload}) {
  return {status:'succeeded', providerReference:`test_charge_${crypto.randomUUID()}`, metadata:{test:true,confirmedAt:new Date().toISOString(),paymentMethod:payload.request?.paymentMethod || 'test_card'}};
}
