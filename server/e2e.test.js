import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import app from './app.js';
import {closeDb, query} from './db.js';

let server;
let base;
let context;
let auth;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  context = {'content-type':'application/json','x-tenant-id':'us','x-universe-id':'consumer','x-locale':'en-US','x-currency':'USD','x-channel':'web'};
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await closeDb();
});

async function request(path, options = {}) {
  const response = await fetch(base + path, {...options, headers:{...context,...(options.headers || {})}});
  const body = response.status === 204 ? null : await response.json();
  assert.equal(response.ok, true, `${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

test('customer completes registered checkout flow', async () => {
  const email = `e2e-${Date.now()}@example.com`;
  auth = await request('/api/auth/register', {method:'POST', body:JSON.stringify({email,password:'e2e-password-123',firstName:'End',lastName:'ToEnd'})});
  assert.equal(auth.user.email, email);
  let bearer = {authorization:`Bearer ${auth.accessToken}`};
  const experience = await request('/api/experience');
  assert.equal(experience.data.experience.branding.name, 'Marketly');
  await request('/api/seller/onboarding', {method:'POST',headers:bearer,body:JSON.stringify({displayName:'E2E Seller'})});
  const refreshed = await request('/api/auth/refresh', {method:'POST',body:JSON.stringify({refreshToken:auth.refreshToken})});
  bearer = {authorization:`Bearer ${refreshed.accessToken}`};
  const support = await request('/api/support/cases', {method:'POST',headers:{...bearer,'idempotency-key':`support-${Date.now()}`},body:JSON.stringify({subject:'Where is my order?',details:{channel:'web'}})});
  assert.equal(support.data.status, 'open');
  const supportTransition = await request(`/api/support/cases/${support.data.id}/transition`, {method:'POST',headers:{...bearer,'idempotency-key':`support-transition-${Date.now()}`},body:JSON.stringify({fromState:'open',event:'start'})});
  assert.equal(supportTransition.data.status, 'in_progress');
  const subscription = await request('/api/subscriptions', {method:'POST',headers:{...bearer,'idempotency-key':`subscription-${Date.now()}`},body:JSON.stringify({plan:'marketly-plus',interval:'month'})});
  assert.equal(subscription.data.status, 'active');
  const pausedSubscription = await request(`/api/subscriptions/${subscription.data.id}/transition`, {method:'POST',headers:{...bearer,'idempotency-key':`subscription-pause-${Date.now()}`},body:JSON.stringify({fromState:'active',event:'pause'})});
  assert.equal(pausedSubscription.data.status, 'paused');
  const sellerProduct = await request('/api/seller/catalog/products', {method:'POST',headers:bearer,body:JSON.stringify({typeKey:'physical',sku:`E2E-${Date.now()}`,slug:`e2e-${Date.now()}`,title:'Configurable E2E Item',price:55,currency:'USD'})});
  await query(`insert into inventory_items (tenant_id,product_id,location_code,available) values ('us',$1,'default',100) on conflict (tenant_id,product_id,location_code) do update set available = 100`, [sellerProduct.data.id]);
  const variant = await request(`/api/seller/catalog/products/${sellerProduct.data.id}/variants`, {method:'POST',headers:bearer,body:JSON.stringify({sku:`E2E-V-${Date.now()}`,title:'Blue / Large',options:{color:'blue',size:'large'},price:59,currency:'USD'})});
  const offer = await request(`/api/seller/catalog/products/${sellerProduct.data.id}/offers`, {method:'POST',headers:bearer,body:JSON.stringify({offerKey:`e2e-offer-${Date.now()}`,variantId:variant.data.id,price:57,currency:'USD',fulfillmentMode:'seller'})});
  const variants = await request(`/api/catalog/products/${sellerProduct.data.id}/variants`);
  const offers = await request(`/api/catalog/products/${sellerProduct.data.id}/offers`);
  assert.equal(variants.data.length, 1);
  assert.equal(offers.data.buyBox.id, offer.data.id);
  const catalog = await request('/api/catalog/products?pageSize=1');
  assert.equal(catalog.data.length, 1);
  const product = catalog.data[0];
  const cart = await request('/api/cart/items', {method:'POST',headers:bearer,body:JSON.stringify({productId:product.id,quantity:1})});
  assert.equal(cart.data.items.length, 1);
  const shippingAddress = {recipient:'End ToEnd',line1:'1 Test Way',city:'New York',postalCode:'10001',country:'US'};
  const quote = await request('/api/checkout/quote', {method:'POST',headers:bearer,body:JSON.stringify({shippingAddress})});
  assert.equal(quote.data.currency, 'USD');
  assert.equal(typeof quote.data.tax, 'number');
  const order = await request('/api/orders', {method:'POST',headers:{...bearer,'idempotency-key':`order-${Date.now()}`},body:JSON.stringify({shippingAddress,shippingOptionId:quote.data.shippingOption.id})});
  assert.equal(order.data.status, 'pending_payment');
  const intent = await request('/api/payments/intents', {method:'POST',headers:bearer,body:JSON.stringify({orderId:order.data.id,connectorKey:'test'})});
  assert.equal(intent.data.status, 'requires_payment_method');
  const confirmed = await request(`/api/payments/intents/${intent.data.id}/confirm`, {method:'POST',headers:bearer,body:JSON.stringify({paymentMethod:'test_card'})});
  assert.equal(confirmed.data.status, 'succeeded');
  const shipment = await request(`/api/orders/${order.data.id}/shipments`, {method:'POST',headers:bearer,body:JSON.stringify({connectorKey:'test-fulfillment'})});
  assert.equal(shipment.data.status, 'label_created');
  const shipments = await request(`/api/orders/${order.data.id}/shipments`, {headers:bearer});
  assert.equal(shipments.data.length, 1);
  const orders = await request('/api/orders', {headers:bearer});
  assert.equal(orders.data[0].status, 'paid');
  await query(`update orders set status = 'delivered' where id = $1`, [order.data.id]);
  const exchange = await request(`/api/orders/${order.data.id}/exchanges`, {method:'POST',headers:bearer,body:JSON.stringify({reason:'changed_mind',items:[{productId:product.id,quantity:1}],replacementItems:[{productId:sellerProduct.data.id,variantId:variant.data.id,quantity:1}]})});
  assert.equal(exchange.data.status, 'requested');
  const requests = await request(`/api/orders/${order.data.id}/post-purchase-requests`, {headers:bearer});
  assert.equal(requests.data[0].id, exchange.data.id);
});
