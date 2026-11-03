import {query, withTenant} from './db.js';
import {HttpError} from './http.js';
import {assertTransition, resolvePolicy, resolveStateMachine} from './registry.js';

function money(value) { return value === null || value === undefined ? null : Number(value); }
function array(value) { return Array.isArray(value) ? value : []; }

async function resolveProduct(context, productId) {
  const result = await query(`select id,seller_id as "sellerId",product_type_key as "typeKey",title,currency,price from products where id = $1 and tenant_id = $2 and universe_id = $3 and status in ('active','paused')`, [productId, context.tenantId, context.universeId]);
  if (!result.rowCount) throw new HttpError(404, 'Product was not found', 'product_not_found');
  return result.rows[0];
}

async function assertSellerOwnership(context, actor, product) {
  if (!actor || ['admin','owner'].includes(actor.role)) return;
  if (!product.sellerId) throw new HttpError(403, 'This product is not owned by the current seller', 'seller_product_forbidden');
  const seller = await query(`select id from seller_profiles where id = $1 and tenant_id = $2 and user_id = $3`, [product.sellerId, context.tenantId, actor.sub]);
  if (!seller.rowCount) throw new HttpError(403, 'This product is not owned by the current seller', 'seller_product_forbidden');
}

export async function listVariants(context, productId) {
  await resolveProduct(context, productId);
  const result = await query(`select id,sku,barcode,title,options,media,attributes,price,currency,status,created_at as "createdAt",updated_at as "updatedAt" from product_variants where tenant_id = $1 and universe_id = $2 and product_id = $3 and status <> 'archived' order by created_at`, [context.tenantId, context.universeId, productId]);
  return result.rows.map(row => ({...row,price:money(row.price)}));
}

export async function createVariant(context, actor, productId, input) {
  const product = await resolveProduct(context, productId);
  await assertSellerOwnership(context, actor, product);
  if (!input?.sku || input.price === undefined || !input.currency) throw new HttpError(400, 'sku, price, and currency are required', 'variant_validation_error');
  const result = await query(`insert into product_variants (tenant_id,universe_id,product_id,sku,barcode,title,options,media,attributes,price,currency) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id,product_id as "productId",sku,barcode,title,options,media,attributes,price,currency,status,created_at as "createdAt",updated_at as "updatedAt"`, [context.tenantId, context.universeId, product.id, input.sku, input.barcode || null, input.title || product.title, input.options || {}, input.media || [], input.attributes || {}, input.price, input.currency]);
  return {...result.rows[0],price:money(result.rows[0].price)};
}

export async function updateVariant(context, actor, productId, variantId, input) {
  const product = await resolveProduct(context, productId);
  await assertSellerOwnership(context, actor, product);
  const result = await query(`update product_variants set barcode = coalesce($1,barcode),title = coalesce($2,title),options = coalesce($3,options),media = coalesce($4,media),attributes = coalesce($5,attributes),price = coalesce($6,price),currency = coalesce($7,currency),status = coalesce($8,status),updated_at = now() where id = $9 and tenant_id = $10 and universe_id = $11 and product_id = $12 returning id,product_id as "productId",sku,barcode,title,options,media,attributes,price,currency,status,created_at as "createdAt",updated_at as "updatedAt"`, [input.barcode, input.title, input.options, input.media, input.attributes, input.price, input.currency, input.status, variantId, context.tenantId, context.universeId, productId]);
  if (!result.rowCount) throw new HttpError(404, 'Product variant was not found', 'variant_not_found');
  return {...result.rows[0],price:money(result.rows[0].price)};
}

async function resolveSeller(context, actor, sellerId) {
  if (sellerId && ['admin','owner'].includes(actor.role)) {
    const requested = await query(`select id from seller_profiles where id = $1 and tenant_id = $2`, [sellerId, context.tenantId]);
    if (!requested.rowCount) throw new HttpError(404, 'Seller was not found', 'seller_not_found');
    return requested.rows[0].id;
  }
  const own = await query(`select id from seller_profiles where user_id = $1 and tenant_id = $2 and status in ('pending','approved')`, [actor.sub, context.tenantId]);
  if (!own.rowCount) throw new HttpError(422, 'Complete seller onboarding before creating an offer', 'seller_profile_required');
  return own.rows[0].id;
}

export async function createOffer(context, actor, productId, input) {
  const product = await resolveProduct(context, productId);
  await assertSellerOwnership(context, actor, product);
  if (!input?.offerKey || input.price === undefined) throw new HttpError(400, 'offerKey and price are required', 'offer_validation_error');
  const sellerId = await resolveSeller(context, actor, input.sellerId);
  if (input.variantId) {
    const variant = await query(`select id from product_variants where id = $1 and tenant_id = $2 and universe_id = $3 and product_id = $4`, [input.variantId, context.tenantId, context.universeId, productId]);
    if (!variant.rowCount) throw new HttpError(422, 'Offer variant does not belong to this product', 'variant_product_mismatch');
  }
  const result = await query(`insert into product_offers (tenant_id,universe_id,product_id,variant_id,seller_id,offer_key,price,currency,compare_at_price,quantity_limit,condition,fulfillment_mode,promise,promotions,status,effective_from,effective_until) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,coalesce($16,now()),$17) returning id,product_id as "productId",variant_id as "variantId",seller_id as "sellerId",offer_key as "offerKey",price,currency,compare_at_price as "compareAtPrice",quantity_limit as "quantityLimit",condition,fulfillment_mode as "fulfillmentMode",promise,promotions,status,effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [context.tenantId, context.universeId, productId, input.variantId || null, sellerId, input.offerKey, input.price, input.currency || context.currency, input.compareAtPrice ?? null, input.quantityLimit ?? null, input.condition || 'new', input.fulfillmentMode || 'platform', input.promise || {}, input.promotions || [], input.status || 'active', input.effectiveFrom || null, input.effectiveUntil || null]);
  return {...result.rows[0],price:money(result.rows[0].price),compareAtPrice:money(result.rows[0].compareAtPrice)};
}

export async function updateOffer(context, actor, offerId, input) {
  const result = await query(`update product_offers o set price = coalesce($1,o.price),compare_at_price = coalesce($2,o.compare_at_price),quantity_limit = coalesce($3,o.quantity_limit),promise = coalesce($4,o.promise),promotions = coalesce($5,o.promotions),fulfillment_mode = coalesce($6,o.fulfillment_mode),status = coalesce($7,o.status),effective_until = coalesce($8,o.effective_until) from products p where o.id = $9 and o.tenant_id = $10 and o.universe_id = $11 and o.product_id = p.id and ($12 in ('admin','owner') or o.seller_id = (select id from seller_profiles where user_id = $13 and tenant_id = $10)) returning o.id,o.product_id as "productId",o.variant_id as "variantId",o.seller_id as "sellerId",o.offer_key as "offerKey",o.price,o.currency,o.compare_at_price as "compareAtPrice",o.quantity_limit as "quantityLimit",o.condition,o.fulfillment_mode as "fulfillmentMode",o.promise,o.promotions,o.status,o.effective_from as "effectiveFrom",o.effective_until as "effectiveUntil"`, [input.price, input.compareAtPrice, input.quantityLimit, input.promise, input.promotions, input.fulfillmentMode, input.status, input.effectiveUntil, offerId, context.tenantId, context.universeId, actor.role, actor.sub]);
  if (!result.rowCount) throw new HttpError(404, 'Offer was not found or is not owned by this seller', 'offer_not_found');
  return {...result.rows[0],price:money(result.rows[0].price),compareAtPrice:money(result.rows[0].compareAtPrice)};
}

export async function resolveCommercePolicy(context, policyKey, input) {
  const policy = await resolvePolicy(context, policyKey);
  if (!policy) throw new HttpError(422, `Policy is not configured: ${policyKey}`, 'policy_not_configured');
  const definition = policy.definition || {};
  const orderStatus = input.order.status;
  if (array(definition.eligibleStatuses).length && !definition.eligibleStatuses.includes(orderStatus)) return {eligible:false,policy,reason:'order_status_not_eligible'};
  if (definition.windowDays !== undefined) {
    const age = (Date.now() - new Date(input.order.createdAt || input.order.created_at).getTime()) / 86400000;
    if (!Number.isFinite(age) || age > Number(definition.windowDays)) return {eligible:false,policy,reason:'policy_window_expired'};
  }
  if (array(definition.allowedReasons).length && !definition.allowedReasons.includes(input.reason)) return {eligible:false,policy,reason:'reason_not_allowed'};
  if (input.requestType === 'exchange' && definition.allowExchange === false) return {eligible:false,policy,reason:'exchange_not_allowed'};
  if (input.requestType === 'replacement' && definition.allowReplacement === false) return {eligible:false,policy,reason:'replacement_not_allowed'};
  return {eligible:true,policy};
}

export async function createExchange(context, actor, orderId, input) {
  if (!input?.reason || !array(input.items).length) throw new HttpError(400, 'reason and items are required', 'exchange_validation_error');
  const requestType = input.requestType || 'exchange';
  if (!['exchange','replacement','trade_in'].includes(requestType)) throw new HttpError(400, 'Unsupported post-purchase request type', 'exchange_validation_error');
  const order = await query(`select id,status,created_at as "createdAt",currency from orders where id = $1 and tenant_id = $2 and universe_id = $3 and user_id = $4`, [orderId, context.tenantId, context.universeId, actor.sub]);
  if (!order.rowCount) throw new HttpError(404, 'Order was not found', 'order_not_found');
  const policyKey = input.policyKey || (requestType === 'exchange' ? 'commerce.exchange' : 'commerce.replacement');
  const decision = await resolveCommercePolicy(context, policyKey, {order:order.rows[0],reason:input.reason,requestType});
  if (!decision.eligible) throw new HttpError(409, 'This order is not eligible for the requested resolution', decision.reason);
  if (requestType === 'exchange' && !array(input.replacementItems).length) throw new HttpError(400, 'replacementItems are required for an exchange', 'exchange_validation_error');
  const result = await query(`insert into exchange_requests (tenant_id,universe_id,order_id,user_id,request_type,reason,status,items,replacement_items,price_difference,currency,policy_key,metadata) values ($1,$2,$3,$4,$5,$6,'requested',$7::jsonb,$8::jsonb,$9,$10,$11,$12) returning id,order_id as "orderId",request_type as "requestType",reason,status,items,replacement_items as "replacementItems",price_difference as "priceDifference",currency,policy_key as "policyKey",resolution,metadata,created_at as "createdAt",updated_at as "updatedAt"`, [context.tenantId, context.universeId, orderId, actor.sub, requestType, input.reason, JSON.stringify(input.items), JSON.stringify(input.replacementItems || []), input.priceDifference || 0, order.rows[0].currency, policyKey, input.metadata || {}]);
  await query(`insert into outbox_events (tenant_id,universe_id,event_type,aggregate_type,aggregate_id,payload) values ($1,$2,'exchange.requested','exchange',$3,$4)`, [context.tenantId, context.universeId, result.rows[0].id, {exchangeId:result.rows[0].id,orderId,requestType}]);
  return result.rows[0];
}

export async function transitionExchange(context, exchangeId, input) {
  if (!input?.fromState || !input.event) throw new HttpError(400, 'fromState and event are required', 'exchange_transition_validation_error');
  const exchange = await query(`select id,status,order_id as "orderId" from exchange_requests where id = $1 and tenant_id = $2 and universe_id = $3`, [exchangeId, context.tenantId, context.universeId]);
  if (!exchange.rowCount) throw new HttpError(404, 'Exchange request was not found', 'exchange_not_found');
  if (exchange.rows[0].status !== input.fromState) throw new HttpError(409, 'Exchange request state has changed', 'exchange_version_conflict');
  const machine = await resolveStateMachine(context, input.stateMachineKey || 'post_purchase_exchange');
  if (!machine) throw new HttpError(422, 'Exchange state machine is not configured', 'state_machine_not_configured');
  const transition = assertTransition(machine, input.fromState, input.event);
  const result = await query(`update exchange_requests set status = $1,resolution = resolution || $2::jsonb,updated_at = now() where id = $3 and tenant_id = $4 and status = $5 returning id,order_id as "orderId",request_type as "requestType",reason,status,items,replacement_items as "replacementItems",price_difference as "priceDifference",currency,policy_key as "policyKey",resolution,metadata,created_at as "createdAt",updated_at as "updatedAt"`, [transition.to, JSON.stringify(input.resolution || {}), exchangeId, context.tenantId, input.fromState]);
  if (!result.rowCount) throw new HttpError(409, 'Exchange request state has changed', 'exchange_version_conflict');
  await query(`insert into outbox_events (tenant_id,universe_id,event_type,aggregate_type,aggregate_id,payload) values ($1,$2,'exchange.transitioned','exchange',$3,$4)`, [context.tenantId, context.universeId, exchangeId, {exchangeId,orderId:exchange.rows[0].orderId,fromState:input.fromState,toState:transition.to,event:input.event}]);
  return {...result.rows[0],transition:{event:input.event,from:input.fromState,to:transition.to}};
}

export async function listExchanges(context, actor, orderId) {
  const result = await query(`select id,order_id as "orderId",request_type as "requestType",reason,status,items,replacement_items as "replacementItems",price_difference as "priceDifference",currency,policy_key as "policyKey",resolution,metadata,created_at as "createdAt",updated_at as "updatedAt" from exchange_requests where tenant_id = $1 and universe_id = $2 and user_id = $3 and ($4::uuid is null or order_id = $4) order by created_at desc`, [context.tenantId, context.universeId, actor.sub, orderId || null]);
  return result.rows.map(row => ({...row,priceDifference:money(row.priceDifference)}));
}

export async function listOffersWithBuyBox(context, productId) {
  const result = await query(`select o.id,o.product_id as "productId",o.variant_id as "variantId",o.seller_id as "sellerId",o.offer_key as "offerKey",o.price,o.currency,o.compare_at_price as "compareAtPrice",o.quantity_limit as "quantityLimit",o.condition,o.fulfillment_mode as "fulfillmentMode",o.promise,o.promotions,o.status,o.effective_from as "effectiveFrom",o.effective_until as "effectiveUntil" from product_offers o where o.tenant_id = $1 and o.universe_id = $2 and o.product_id = $3 and o.status = 'active' and o.effective_from <= now() and (o.effective_until is null or o.effective_until > now()) order by o.price asc,o.created_at asc`, [context.tenantId, context.universeId, productId]);
  const offers = result.rows.map(row => ({...row,price:money(row.price),compareAtPrice:money(row.compareAtPrice)}));
  return {offers,buyBox:offers[0] || null,selection:{strategy:'price_then_created_at',configured:true}};
}
