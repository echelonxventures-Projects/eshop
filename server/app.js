import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from './config.js';
import {capabilities, health, query, resources, withTenant} from './db.js';
import {resolveContext, requireRole} from './context.js';
import {authenticate, createUser, requireAuth, rotateRefreshToken} from './auth.js';
import {asyncRoute, HttpError, pageParams, requireBody} from './http.js';
import {executeConnector, resolveConnector} from './connectors.js';
import {publicRuntimeConfig} from './runtime-config.js';
import {assertEntityData, listEntityTypes, resolveEntityType, resolveRelationshipType} from './registry.js';
import {manifestConfiguration, resolveConfiguration} from './configuration.js';
import {executeCommand} from './commands.js';
import {convert, createAccount, getAccounts, postEntry, resolveModule} from './modules.js';
import {listBundles, registerCapabilityBundle} from './capabilities.js';
import {publishEvent} from './events.js';
import {saveConnectorSecret} from './secrets.js';
import {createCatalogProduct, listOffers, listProductTypes, updateCatalogProduct} from './catalog.js';
import {createExchange, createOffer, createVariant, listExchanges, listOffersWithBuyBox, listVariants, resolveCommercePolicy, transitionExchange, updateOffer, updateVariant} from './commerce.js';
import {metricsMiddleware, metricsText, sloSnapshot} from './observability.js';
import {createRateLimiter} from './rate-limit.js';
import {acceptWebhook} from './webhooks.js';

const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));
const platformConfig = JSON.parse(fs.readFileSync(path.join(here, '..', 'platform-config.json'), 'utf8'));

app.set('trust proxy', config.trustProxy);
app.use(helmet({crossOriginResourcePolicy:false}));
app.use(cors({origin:config.corsOrigin, credentials:true}));
app.use(express.json({limit:config.bodyLimit, verify:(req, _res, buffer) => {req.rawBody = Buffer.from(buffer);}}));
app.use((req, res, next) => {req.requestId = crypto.randomUUID();res.setHeader('x-request-id', req.requestId);next();});
app.use(metricsMiddleware);
const limiter = createRateLimiter({windowMs:config.rateLimitWindowMs, max:config.rateLimitMax, key:req => req.ip || req.socket.remoteAddress || 'unknown'});
app.use((req, res, next) => ['/api/live','/api/health','/api/ready','/api/metrics'].includes(req.path) ? next() : limiter(req, res, next));

app.get('/api/health', asyncRoute(async (_req, res) => {
  await health();
  res.json({ok:true, service:'marketly-api', version:'1.0.0', time:new Date().toISOString()});
}));
app.get('/api/live', (_req, res) => res.json({ok:true, service:'marketly-api'}));
app.get('/api/metrics', (req, res) => {
  if (config.metricsToken && req.get('authorization') !== `Bearer ${config.metricsToken}`) return res.status(401).type('text/plain').send('Unauthorized\n');
  res.type('text/plain').send(metricsText());
});
app.get('/api/health/slo', (req, res) => {
  if (config.metricsToken && req.get('authorization') !== `Bearer ${config.metricsToken}`) return res.status(401).json({error:{code:'unauthorized',message:'Metrics authorization required'}});
  res.json({data:sloSnapshot(Number(req.query.windowMs || 300000))});
});
app.get('/api/ready', asyncRoute(async (_req, res) => {
  try {
    await health();
    res.json({ok:true, service:'marketly-api', dependencies:{storage:true}});
  } catch (error) {
    res.status(503).json({ok:false, service:'marketly-api', dependencies:{storage:false}, error:{code:'storage_unavailable',message:'The configured storage provider is not ready'}});
  }
}));

app.get('/api/config', (_req, res) => res.json({platform:platformConfig.platform, tenants:platformConfig.tenants, universes:platformConfig.universes, locales:platformConfig.locales.map(({id,label}) => ({id,label})), currencies:platformConfig.currencies.map(({id,label}) => ({id,label})), extensionPoints:platformConfig.extensionPoints, defaults:publicRuntimeConfig()}));
app.use('/api', resolveContext);

app.post('/api/webhooks/:serviceType/:key', asyncRoute(async (req, res) => {
  const connector = await resolveConnector(req.context, req.params.serviceType, req.params.key);
  const result = await acceptWebhook({connector, context:req.context, req});
  res.status(result.duplicate ? 200 : 202).json({data:{accepted:true,...result}});
}));

app.post('/api/analytics/events', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['type']);
  if (!/^analytics\.[a-z][a-z0-9_.-]{1,80}$/.test(req.body.type)) throw new HttpError(400, 'Analytics event types must use the analytics.* namespace', 'invalid_analytics_event');
  const event = await publishEvent({type:req.body.type,source:'marketly:web',subject:req.body.subject || req.user.sub,data:req.body.data || {},context:req.context,correlationId:req.header('x-correlation-id')});
  res.status(202).json({data:{eventId:event.envelope.id,accepted:true}});
}));

app.get('/api/catalog/search', asyncRoute(async (req, res) => {
  requireBody(req.query, ['q']);
  const q = String(req.query.q).trim().slice(0, 120);
  if (!q) throw new HttpError(400, 'Search query cannot be empty', 'invalid_search_query');
  try {
    const connector = await resolveConnector(req.context, 'search', req.query.connectorKey);
    const provider = await executeConnector({connector,operation:'search',context:req.context,payload:{query:q,filters:req.query}});
    return res.json({data:provider,source:'provider',connector:connector.connector_key});
  } catch (error) {
    if (error.code !== 'connector_unavailable') throw error;
  }
  const {page,pageSize,offset} = pageParams(req.query);
  const values = [req.context.tenantId,req.context.universeId,`%${q}%`,pageSize,offset];
  const result = await query(`select p.id,p.product_type_key as "typeKey",p.sku,p.slug,p.title,p.description,p.media,p.attributes,p.price,p.currency,p.compare_at_price as "compareAtPrice",p.rating,p.review_count as "reviewCount",ts_rank(to_tsvector('simple',p.title || ' ' || p.description),websearch_to_tsquery('simple',$3)) as "relevance" from products p where p.tenant_id = $1 and p.universe_id = $2 and p.status = 'active' and (to_tsvector('simple',p.title || ' ' || p.description) @@ websearch_to_tsquery('simple',$3) or p.title ilike $3 or p.description ilike $3) order by "relevance" desc,p.rating desc,p.created_at desc limit $4 offset $5`, values);
  res.json({data:result.rows.map(productResponse),source:'local',pagination:{page,pageSize}});
}));

app.get('/api/recommendations', asyncRoute(async (req, res) => {
  const connector = await resolveConnector(req.context, 'recommendations', req.query.connectorKey).catch(error => {if (error.code === 'connector_unavailable') return null; throw error;});
  if (connector) { const provider = await executeConnector({connector,operation:'recommend',context:req.context,payload:{userId:req.user?.sub || null,productId:req.query.productId || null,limit:Number(req.query.limit || 12)}}); return res.json({data:provider,source:'provider',connector:connector.connector_key}); }
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 12)));
  const result = await query(`select p.id,p.product_type_key as "typeKey",p.sku,p.slug,p.title,p.description,p.media,p.attributes,p.price,p.currency,p.compare_at_price as "compareAtPrice",p.rating,p.review_count as "reviewCount" from products p where p.tenant_id = $1 and p.universe_id = $2 and p.status = 'active' order by p.rating desc,p.review_count desc,p.created_at desc limit $3`, [req.context.tenantId,req.context.universeId,limit]);
  res.json({data:result.rows.map(productResponse),source:'catalog'});
}));

function publicUser(user) { return {id:user.id, email:user.email, firstName:user.first_name, lastName:user.last_name, role:user.role}; }
function productResponse(row) { return {...row, price:Number(row.price), compareAtPrice:row.compare_at_price === null ? null : Number(row.compare_at_price), rating:Number(row.rating), reviewCount:Number(row.review_count), media:row.media || [], attributes:row.attributes || {}}; }

app.get('/api/experience', asyncRoute(async (req, res) => {
  const experience = await resolveConfiguration(req.context, 'experience', 'default', manifestConfiguration('experience', 'default', {}));
  const modules = await query(`select module_key as "moduleKey",display_name as "displayName",labels,capabilities,entities,config,units,enabled,version from module_definitions where tenant_id = $1 and (universe_id = $2 or universe_id is null) and enabled = true order by module_key`, [req.context.tenantId, req.context.universeId]);
  res.json({data:{context:req.context,experience,modules:modules.rows}});
}));

app.get('/api/configuration/:namespace/:key', requireAuth, asyncRoute(async (req, res) => {
  const value = await resolveConfiguration(req.context, req.params.namespace, req.params.key, manifestConfiguration(req.params.namespace, req.params.key, {}));
  res.json({data:{namespace:req.params.namespace,key:req.params.key,value,context:req.context}});
}));

app.post('/api/services/:serviceType/:operation', requireAuth, asyncRoute(async (req, res) => {
  const connector = await resolveConnector(req.context, req.params.serviceType, req.body.connectorKey);
  const data = await executeConnector({connector, operation:req.params.operation, context:req.context, payload:req.body});
  res.json({data, connector:{key:connector.connector_key,serviceType:connector.service_type}});
}));

app.post('/api/commands/:commandKey', requireAuth, asyncRoute(async (req, res) => {
  const execution = await executeCommand(req.context, req.user, req.params.commandKey, req.body || {}, req.header('idempotency-key'));
  res.status(execution.status === 'succeeded' ? 200 : 202).json({data:execution});
}));

async function listOwnedRecords(req, entityKey) {
  const type = await resolveEntityType(req.context, entityKey);
  const result = await query(`select id,external_key as "externalKey",data,version,status,created_at as "createdAt",updated_at as "updatedAt" from entity_records where tenant_id = $1 and entity_type_id = $2 and universe_id = $3 and created_by = $4 and status <> 'deleted' order by updated_at desc`, [req.context.tenantId, type.id, req.context.universeId, req.user.sub]);
  return {data:result.rows,entityType:{key:type.entity_key,displayName:type.display_name,schema:type.schema}};
}

app.get('/api/support/cases', requireAuth, asyncRoute(async (req, res) => res.json(await listOwnedRecords(req, 'support_case'))));
app.post('/api/support/cases', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['subject']);
  const execution = await executeCommand(req.context, req.user, 'support_case.create', {data:{subject:req.body.subject,status:'open',priority:req.body.priority || 'normal',details:req.body.details || {}}}, req.header('idempotency-key'));
  res.status(201).json({data:execution.output});
}));
app.post('/api/support/cases/:id/transition', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['fromState','event']);
  const execution = await executeCommand(req.context, req.user, 'support_case.transition', {entityId:req.params.id,stateMachineKey:'support_case',fromState:req.body.fromState,event:req.body.event}, req.header('idempotency-key'));
  res.json({data:execution.output});
}));
app.get('/api/subscriptions', requireAuth, asyncRoute(async (req, res) => res.json(await listOwnedRecords(req, 'subscription'))));
app.post('/api/subscriptions', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['plan']);
  const execution = await executeCommand(req.context, req.user, 'subscription.create', {data:{plan:req.body.plan,status:'active',interval:req.body.interval || 'month',nextBillingAt:req.body.nextBillingAt || null}}, req.header('idempotency-key'));
  res.status(201).json({data:execution.output});
}));
app.post('/api/subscriptions/:id/transition', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['fromState','event']);
  const execution = await executeCommand(req.context, req.user, 'subscription.transition', {entityId:req.params.id,stateMachineKey:'subscription',fromState:req.body.fromState,event:req.body.event}, req.header('idempotency-key'));
  res.json({data:execution.output});
}));

app.post('/api/events', requireAuth, asyncRoute(async (req, res) => {
  const event = await publishEvent({type:req.body.type,source:req.body.source,subject:req.body.subject,data:req.body.data,context:req.context,correlationId:req.body.correlationId,causationId:req.body.causationId,eventId:req.body.eventId});
  res.status(202).json({data:event});
}));

app.get('/api/modules/:moduleKey', asyncRoute(async (req, res) => {
  const module = await resolveModule(req.context, req.params.moduleKey);
  res.json({data:{key:module.module_key,displayName:module.display_name,labels:module.labels,capabilities:module.capabilities,entities:module.entities,config:module.config,units:module.units,version:module.version}});
}));

app.post('/api/modules/:moduleKey/convert', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['amount','fromUnit','toUnit']);
  res.json({data:await convert(req.context, req.params.moduleKey, req.body.amount, req.body.fromUnit, req.body.toUnit)});
}));

app.get('/api/modules/:moduleKey/accounts', requireAuth, asyncRoute(async (req, res) => {
  res.json({data:await getAccounts(req.context, {type:'user',id:req.user.sub}, req.params.moduleKey)});
}));

app.post('/api/modules/:moduleKey/accounts', requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json({data:await createAccount(req.context, {type:'user',id:req.user.sub}, req.params.moduleKey, req.body)});
}));

app.post('/api/modules/:moduleKey/accounts/:accountId/entries', requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json({data:await postEntry(req.context, {type:'user',id:req.user.sub}, req.params.moduleKey, req.params.accountId, req.body, req.header('idempotency-key'))});
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  requireBody(req.body, ['email','password']);
  const passwordPolicy = await resolveConfiguration(req.context, 'identity', 'passwordPolicy', manifestConfiguration('identity', 'passwordPolicy', {}));
  if (String(req.body.password).length < Number(passwordPolicy.minLength)) throw new HttpError(400, `Password must be at least ${passwordPolicy.minLength} characters`, 'validation_error');
  const result = await createUser(req.body, req.context);
  res.status(201).json({user:publicUser(result.user), accessToken:result.accessToken, refreshToken:result.refreshToken.token, refreshExpiresAt:result.refreshToken.expiresAt});
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  requireBody(req.body, ['email','password']);
  const result = await authenticate(req.body.email, req.body.password, req.context);
  res.json({user:publicUser(result.user), accessToken:result.accessToken, refreshToken:result.refreshToken.token, refreshExpiresAt:result.refreshToken.expiresAt});
}));

app.post('/api/auth/refresh', asyncRoute(async (req, res) => {
  requireBody(req.body, ['refreshToken']);
  const result = await rotateRefreshToken(req.body.refreshToken, req.context);
  res.json({user:publicUser(result.user), accessToken:result.accessToken, refreshToken:result.refreshToken.token, refreshExpiresAt:result.refreshToken.expiresAt});
}));

app.get('/api/me', requireAuth, asyncRoute(async (req, res) => {
  const result = await query(`select u.id, u.email, u.first_name, u.last_name, coalesce(tm.role, u.role) as role, tm.permissions from users u join tenant_memberships tm on tm.user_id = u.id and tm.tenant_id = $1 where u.id = $2`, [req.context.tenantId, req.user.sub]);
  if (!result.rowCount) throw new HttpError(404, 'Account was not found', 'user_not_found');
  res.json({data:{...publicUser(result.rows[0]), permissions:result.rows[0].permissions || [], context:req.context}});
}));

app.get('/api/me/export', requireAuth, asyncRoute(async (req, res) => {
  const [user, addresses, orders, reviews] = await Promise.all([
    query(`select id,email,first_name as "firstName",last_name as "lastName",role,status,metadata,created_at as "createdAt" from users where id = $1`, [req.user.sub]),
    query(`select id,label,recipient,address,is_default as "isDefault",created_at as "createdAt" from addresses where tenant_id = $1 and user_id = $2 order by created_at`, [req.context.tenantId,req.user.sub]),
    query(`select id,order_number as "orderNumber",status,currency,subtotal,tax,shipping,total,shipping_address as "shippingAddress",billing_address as "billingAddress",created_at as "createdAt" from orders where tenant_id = $1 and user_id = $2 order by created_at`, [req.context.tenantId,req.user.sub]),
    query(`select id,product_id as "productId",rating,title,body,status,created_at as "createdAt" from reviews where tenant_id = $1 and user_id = $2 order by created_at`, [req.context.tenantId,req.user.sub])
  ]);
  res.json({data:{exportedAt:new Date().toISOString(),user:user.rows[0] || null,addresses:addresses.rows,orders:orders.rows,reviews:reviews.rows}});
}));

app.get('/api/addresses', requireAuth, asyncRoute(async (req, res) => {
  const result = await query(`select id, label, recipient, address, is_default as "isDefault" from addresses where tenant_id = $1 and user_id = $2 order by is_default desc, created_at desc`, [req.context.tenantId, req.user.sub]);
  res.json({data:result.rows});
}));
app.post('/api/addresses', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['recipient','address']);
  const result = await query(`insert into addresses (tenant_id,user_id,label,recipient,address,is_default) values ($1,$2,$3,$4,$5,$6) returning id,label,recipient,address,is_default as "isDefault"`, [req.context.tenantId, req.user.sub, req.body.label || 'Address', req.body.recipient, req.body.address, Boolean(req.body.isDefault)]);
  res.status(201).json({data:result.rows[0]});
}));
app.delete('/api/addresses/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await query(`delete from addresses where id = $1 and tenant_id = $2 and user_id = $3 returning id`, [req.params.id, req.context.tenantId, req.user.sub]);
  if (!result.rowCount) throw new HttpError(404, 'Address was not found', 'address_not_found');
  res.status(204).end();
}));

app.get('/api/catalog/categories', asyncRoute(async (req, res) => {
  const result = await query(`select id, slug, name, translations, parent_id as "parentId", sort_order as "sortOrder" from categories where tenant_id = $1 and universe_id = $2 and status = 'active' order by sort_order, name`, [req.context.tenantId, req.context.universeId]);
  res.json({data:result.rows});
}));

app.get('/api/catalog/product-types', asyncRoute(async (req, res) => {
  res.json({data:await listProductTypes(req.context)});
}));

app.get('/api/catalog/products', asyncRoute(async (req, res) => {
  const {page,pageSize,offset} = pageParams(req.query, await resolveConfiguration(req.context, 'pagination', 'defaults', manifestConfiguration('pagination', 'defaults', {})));
  const values = [req.context.tenantId, req.context.universeId];
  const where = [`p.tenant_id = $1`, `p.universe_id = $2`, `p.status = 'active'`];
  if (req.query.q) {values.push(`%${String(req.query.q).slice(0,120)}%`); where.push(`(p.title ilike $${values.length} or p.description ilike $${values.length})`);}
  if (req.query.category) {values.push(req.query.category); where.push(`c.slug = $${values.length}`);}
  if (req.query.minPrice) {values.push(Number(req.query.minPrice)); where.push(`p.price >= $${values.length}`);}
  if (req.query.maxPrice) {values.push(Number(req.query.maxPrice)); where.push(`p.price <= $${values.length}`);}
  const count = await query(`select count(*)::int as count from products p left join categories c on c.id = p.category_id where ${where.join(' and ')}`, values);
  values.push(pageSize, offset);
  const result = await query(`select p.id, p.product_type_key as "typeKey", p.sku, p.slug, p.title, p.description, p.media, p.attributes, p.price, p.currency, p.compare_at_price, p.rating, p.review_count, p.fulfillment_config as "fulfillmentConfig", p.compliance_data as "complianceData", c.slug as category from products p left join categories c on c.id = p.category_id where ${where.join(' and ')} order by p.created_at desc limit $${values.length - 1} offset $${values.length}`, values);
  res.json({data:result.rows.map(productResponse), pagination:{page,pageSize,total:count.rows[0].count,totalPages:Math.ceil(count.rows[0].count / pageSize)}});
}));

app.get('/api/catalog/products/:id', asyncRoute(async (req, res) => {
  const result = await query(`select p.*, c.slug as category, pt.display_name as "typeDisplayName", pt.schema as "typeSchema", pt.capabilities as "typeCapabilities", pt.fulfillment_modes as "typeFulfillmentModes" from products p left join categories c on c.id = p.category_id left join product_type_definitions pt on pt.tenant_id = p.tenant_id and (pt.universe_id = p.universe_id or pt.universe_id is null) and pt.type_key = p.product_type_key and pt.enabled = true where p.id = $1 and p.tenant_id = $2 and p.universe_id = $3 and p.status = 'active' order by case when pt.universe_id = p.universe_id then 0 else 1 end,pt.version desc limit 1`, [req.params.id, req.context.tenantId, req.context.universeId]);
  if (!result.rowCount) throw new HttpError(404, 'Product was not found', 'product_not_found');
  res.json({data:productResponse(result.rows[0])});
}));

app.get('/api/catalog/products/:id/offers', asyncRoute(async (req, res) => {
  res.json({data:await listOffersWithBuyBox(req.context, req.params.id)});
}));

app.get('/api/catalog/products/:id/variants', asyncRoute(async (req, res) => {
  res.json({data:await listVariants(req.context, req.params.id)});
}));

app.post('/api/seller/catalog/products', requireAuth, requireRole('seller','admin','owner'), asyncRoute(async (req, res) => {
  res.status(201).json({data:await createCatalogProduct(req.context, req.body, req.user)});
}));
app.patch('/api/seller/catalog/products/:productId', requireAuth, requireRole('seller','admin','owner'), asyncRoute(async (req, res) => {
  res.json({data:await updateCatalogProduct(req.context, req.body, req.user, req.params.productId)});
}));

app.post('/api/seller/catalog/products/:productId/variants', requireAuth, requireRole('seller','admin','owner'), asyncRoute(async (req, res) => {
  res.status(201).json({data:await createVariant(req.context, req.user, req.params.productId, req.body)});
}));

app.patch('/api/seller/catalog/products/:productId/variants/:variantId', requireAuth, requireRole('seller','admin','owner'), asyncRoute(async (req, res) => {
  res.json({data:await updateVariant(req.context, req.user, req.params.productId, req.params.variantId, req.body)});
}));

app.post('/api/seller/catalog/products/:productId/offers', requireAuth, requireRole('seller','admin','owner'), asyncRoute(async (req, res) => {
  res.status(201).json({data:await createOffer(req.context, req.user, req.params.productId, req.body)});
}));

app.patch('/api/seller/catalog/offers/:offerId', requireAuth, requireRole('seller','admin','owner'), asyncRoute(async (req, res) => {
  res.json({data:await updateOffer(req.context, req.user, req.params.offerId, req.body)});
}));

app.get('/api/catalog/products/:id/reviews', asyncRoute(async (req, res) => {
  const {page,pageSize,offset} = pageParams(req.query, await resolveConfiguration(req.context, 'pagination', 'defaults', manifestConfiguration('pagination', 'defaults', {})));
  const result = await query(`select r.id, r.rating, r.title, r.body, r.created_at as "createdAt", u.first_name as "firstName" from reviews r join users u on u.id = r.user_id where r.tenant_id = $1 and r.product_id = $2 and r.status = 'published' order by r.created_at desc limit $3 offset $4`, [req.context.tenantId, req.params.id, pageSize, offset]);
  res.json({data:result.rows, pagination:{page,pageSize}});
}));

app.post('/api/catalog/products/:id/reviews', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['rating','body']);
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Rating must be an integer from 1 to 5', 'validation_error');
  const product = await query(`select id from products where id = $1 and tenant_id = $2 and universe_id = $3`, [req.params.id, req.context.tenantId, req.context.universeId]);
  if (!product.rowCount) throw new HttpError(404, 'Product was not found', 'product_not_found');
  const result = await query(`insert into reviews (tenant_id,product_id,user_id,order_id,rating,title,body) values ($1,$2,$3,$4,$5,$6,$7) returning id,rating,title,body,status,created_at as "createdAt"`, [req.context.tenantId, req.params.id, req.user.sub, req.body.orderId || null, rating, req.body.title || null, req.body.body]);
  res.status(201).json({data:result.rows[0]});
}));

async function getCart(req) {
  let cart = await query(`select id, currency, status from carts where tenant_id = $1 and universe_id = $2 and user_id = $3 and status = 'active'`, [req.context.tenantId, req.context.universeId, req.user.sub]);
  if (!cart.rowCount) {
    cart = await query(`insert into carts (tenant_id, universe_id, user_id, currency) values ($1, $2, $3, $4) returning id, currency, status`, [req.context.tenantId, req.context.universeId, req.user.sub, req.context.currency]);
  }
  const items = await query(`select ci.product_id,ci.variant_id as "variantId",ci.offer_id as "offerId",ci.quantity,ci.unit_price,p.sku,p.title,p.media,p.currency,p.tax_code as "taxCode",p.product_type_key as "typeKey",p.fulfillment_config as "fulfillmentConfig",v.sku as "variantSku",o.offer_key as "offerKey" from cart_items ci join carts c on c.id = ci.cart_id join products p on p.id = ci.product_id left join product_variants v on v.id = ci.variant_id left join product_offers o on o.id = ci.offer_id where ci.cart_id = $1 order by ci.added_at`, [cart.rows[0].id]);
  const subtotal = items.rows.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
  return {id:cart.rows[0].id, currency:cart.rows[0].currency, items:items.rows.map(item => ({...item, unitPrice:Number(item.unit_price), total:Number(item.unit_price) * item.quantity})), subtotal};
}

async function calculateCheckout(context, cart, shippingAddress, shippingOptionId) {
  const policy = await resolveConfiguration(context, 'checkout', 'pricing', manifestConfiguration('checkout', 'pricing', {}));
  const shippingConnector = await resolveConnector(context, policy.shippingServiceType || 'logistics');
  const shipping = await executeConnector({connector:shippingConnector,operation:'getQuotes',context,payload:{cart,items:cart.items,subtotal:cart.subtotal,shippingAddress}});
  const quotes = Array.isArray(shipping.quotes) ? shipping.quotes : [];
  const selectedShipping = quotes.find(quote => quote.id === shippingOptionId) || quotes[0];
  if (!selectedShipping) throw new HttpError(422, 'No delivery option is available for this address', 'shipping_unavailable');
  const taxConnector = await resolveConnector(context, policy.taxServiceType || 'tax');
  const tax = await executeConnector({connector:taxConnector,operation:'calculateTax',context,payload:{cart,items:cart.items,subtotal:cart.subtotal,shipping:Number(selectedShipping.amount || 0),shippingAddress}});
  const shippingAmount = Number(selectedShipping.amount || 0);
  const taxAmount = Number(tax.amount || 0);
  return {subtotal:cart.subtotal,shipping:shippingAmount,tax:taxAmount,total:cart.subtotal + shippingAmount + taxAmount,currency:context.currency,shippingOption:selectedShipping,taxDetails:tax,connectors:{shipping:shippingConnector.connector_key,tax:taxConnector.connector_key}};
}

app.get('/api/cart', requireAuth, asyncRoute(async (req, res) => res.json({data:await getCart(req)})));
app.post('/api/cart/items', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['productId','quantity']);
  const quantity = Number(req.body.quantity);
  const cartPolicy = await resolveConfiguration(req.context, 'cart', 'limits', manifestConfiguration('cart', 'limits', {}));
  const maxQuantity = Number(cartPolicy.maxQuantityPerLine);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity) throw new HttpError(400, `Quantity must be an integer between 1 and ${maxQuantity}`, 'validation_error');
  const product = await query(`select id, price from products where id = $1 and tenant_id = $2 and universe_id = $3 and status = 'active'`, [req.body.productId, req.context.tenantId, req.context.universeId]);
  if (!product.rowCount) throw new HttpError(404, 'Product was not found', 'product_not_found');
  let unitPrice = Number(product.rows[0].price);
  if (req.body.variantId) {
    const variant = await query(`select id,price from product_variants where id = $1 and tenant_id = $2 and universe_id = $3 and product_id = $4 and status = 'active'`, [req.body.variantId, req.context.tenantId, req.context.universeId, req.body.productId]);
    if (!variant.rowCount) throw new HttpError(422, 'Product variant was not found', 'variant_not_found');
    unitPrice = Number(variant.rows[0].price);
  }
  if (req.body.offerId) {
    const offer = await query(`select id,price,variant_id from product_offers where id = $1 and tenant_id = $2 and universe_id = $3 and product_id = $4 and status = 'active' and effective_from <= now() and (effective_until is null or effective_until > now())`, [req.body.offerId, req.context.tenantId, req.context.universeId, req.body.productId]);
    if (!offer.rowCount) throw new HttpError(422, 'Product offer was not found or is no longer active', 'offer_not_found');
    if (offer.rows[0].variant_id && offer.rows[0].variant_id !== (req.body.variantId || null)) throw new HttpError(422, 'Offer does not belong to the selected variant', 'offer_variant_mismatch');
    unitPrice = Number(offer.rows[0].price);
  }
  const cart = await getCart(req);
  await query(`insert into cart_items (cart_id,product_id,variant_id,offer_id,quantity,unit_price) values ($1,$2,$3,$4,$5,$6) on conflict (cart_id,product_id) do update set variant_id = excluded.variant_id,offer_id = excluded.offer_id,quantity = excluded.quantity,unit_price = excluded.unit_price`, [cart.id, product.rows[0].id, req.body.variantId || null, req.body.offerId || null, quantity, unitPrice]);
  res.status(201).json({data:await getCart(req)});
}));
app.patch('/api/cart/items/:productId', requireAuth, asyncRoute(async (req, res) => {
  const quantity = Number(req.body.quantity);
  const cartPolicy = await resolveConfiguration(req.context, 'cart', 'limits', manifestConfiguration('cart', 'limits', {}));
  const maxQuantity = Number(cartPolicy.maxQuantityPerLine);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > maxQuantity) throw new HttpError(400, `Quantity must be an integer between 0 and ${maxQuantity}`, 'validation_error');
  const cart = await getCart(req);
  if (quantity === 0) await query(`delete from cart_items where cart_id = $1 and product_id = $2`, [cart.id, req.params.productId]);
  else await query(`update cart_items set quantity = $1 where cart_id = $2 and product_id = $3`, [quantity, cart.id, req.params.productId]);
  res.json({data:await getCart(req)});
}));

app.post('/api/checkout/quote', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['shippingAddress']);
  const cart = await getCart(req);
  if (!cart.items.length) throw new HttpError(400, 'Your cart is empty', 'empty_cart');
  res.json({data:await calculateCheckout(req.context, cart, req.body.shippingAddress, req.body.shippingOptionId)});
}));

app.post('/api/orders', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['shippingAddress']);
  const idempotencyKey = req.header('idempotency-key');
  if (!idempotencyKey) throw new HttpError(400, 'Idempotency-Key header is required', 'idempotency_required');
  const existing = await query(`select response_status, response_body from idempotency_keys where tenant_id = $1 and user_id = $2 and key = $3 and expires_at > now()`, [req.context.tenantId, req.user.sub, idempotencyKey]);
  if (existing.rowCount && existing.rows[0].response_body) return res.status(existing.rows[0].response_status).json(existing.rows[0].response_body);
  const pricingCart = await getCart(req);
  if (!pricingCart.items.length) throw new HttpError(400, 'Your cart is empty', 'empty_cart');
  const checkout = await calculateCheckout(req.context, pricingCart, req.body.shippingAddress, req.body.shippingOptionId);
  const order = await withTenant(req.context.tenantId, async client => {
    const cart = await client.query(`select c.id from carts c where c.tenant_id = $1 and c.universe_id = $2 and c.user_id = $3 and c.status = 'active' for update`, [req.context.tenantId, req.context.universeId, req.user.sub]);
    if (!cart.rowCount) throw new HttpError(400, 'Your cart is empty', 'empty_cart');
    const items = await client.query(`select ci.product_id,ci.variant_id,ci.offer_id,ci.quantity,ci.unit_price,p.sku,p.title,p.seller_id,p.media,p.attributes from cart_items ci join products p on p.id = ci.product_id where ci.cart_id = $1`, [cart.rows[0].id]);
    if (!items.rowCount) throw new HttpError(400, 'Your cart is empty', 'empty_cart');
    for (const item of items.rows) {
      const stock = await client.query(`select available from inventory_items where tenant_id = $1 and product_id = $2 and location_code = 'default' for update`, [req.context.tenantId, item.product_id]);
      if (!stock.rowCount || stock.rows[0].available < item.quantity) throw new HttpError(409, `${item.title} is out of stock`, 'insufficient_inventory');
    }
    const subtotal = items.rows.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
     const shipping = checkout.shipping;
     const tax = checkout.tax;
     const total = subtotal + shipping + tax;
    const orderNumber = `MKT-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
     const inserted = await client.query(`insert into orders (tenant_id, universe_id, user_id, order_number, currency, subtotal, tax, shipping, total, shipping_address, billing_address, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, order_number, status, currency, subtotal, tax, shipping, total, created_at`, [req.context.tenantId, req.context.universeId, req.user.sub, orderNumber, req.context.currency, subtotal, tax, shipping, total, req.body.shippingAddress, req.body.billingAddress || null, {checkout}]);
    const created = inserted.rows[0];
    for (const item of items.rows) {
      await client.query(`insert into order_items (order_id,product_id,variant_id,offer_id,seller_id,sku,title,quantity,unit_price,total,snapshot) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [created.id, item.product_id, item.variant_id, item.offer_id, item.seller_id, item.sku, item.title, item.quantity, item.unit_price, Number(item.unit_price) * item.quantity, {media:item.media,attributes:item.attributes,variantId:item.variant_id,offerId:item.offer_id}]);
      await client.query(`update inventory_items set available = available - $1, reserved = reserved + $1, version = version + 1 where tenant_id = $2 and product_id = $3 and location_code = 'default'`, [item.quantity, req.context.tenantId, item.product_id]);
    }
    await client.query(`update carts set status = 'converted', updated_at = now() where id = $1`, [cart.rows[0].id]);
    await client.query(`insert into outbox_events (tenant_id, universe_id, event_type, aggregate_type, aggregate_id, payload) values ($1,$2,'order.created','order',$3,$4)`, [req.context.tenantId, req.context.universeId, created.id, {orderId:created.id, orderNumber:created.order_number}]);
    return created;
  });
  const body = {data:order};
   const checkoutPolicy = await resolveConfiguration(req.context, 'checkout', 'pricing', manifestConfiguration('checkout', 'pricing', {}));
  await query(`insert into idempotency_keys (tenant_id, user_id, key, request_hash, response_status, response_body, expires_at) values ($1,$2,$3,$4,$5,$6,now() + ($7 * interval '1 hour')) on conflict (tenant_id, user_id, key) do nothing`, [req.context.tenantId, req.user.sub, idempotencyKey, crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex'), 201, body, Number(checkoutPolicy.idempotencyWindowHours)]);
  res.status(201).json(body);
}));

app.get('/api/orders', requireAuth, asyncRoute(async (req, res) => {
  const {page,pageSize,offset} = pageParams(req.query, await resolveConfiguration(req.context, 'pagination', 'defaults', manifestConfiguration('pagination', 'defaults', {})));
  const result = await query(`select id, order_number as "orderNumber", status, currency, subtotal, tax, shipping, total, created_at as "createdAt" from orders where tenant_id = $1 and universe_id = $2 and user_id = $3 order by created_at desc limit $4 offset $5`, [req.context.tenantId, req.context.universeId, req.user.sub, pageSize, offset]);
  res.json({data:result.rows.map(order => ({...order, subtotal:Number(order.subtotal), tax:Number(order.tax), shipping:Number(order.shipping), total:Number(order.total)})), pagination:{page,pageSize}});
}));
app.get('/api/orders/:id/shipments', requireAuth, asyncRoute(async (req, res) => {
  const result = await query(`select s.id,s.carrier,s.tracking_number as "trackingNumber",s.status,s.events,s.created_at as "createdAt",s.updated_at as "updatedAt" from shipments s join orders o on o.id = s.order_id where s.order_id = $1 and s.tenant_id = $2 and o.universe_id = $3 and o.user_id = $4 order by s.created_at desc`, [req.params.id, req.context.tenantId, req.context.universeId, req.user.sub]);
  res.json({data:result.rows});
}));
app.post('/api/orders/:id/shipments', requireAuth, asyncRoute(async (req, res) => {
  const order = await query(`select id,status,currency,shipping_address as "shippingAddress",total from orders where id = $1 and tenant_id = $2 and universe_id = $3 and user_id = $4`, [req.params.id, req.context.tenantId, req.context.universeId, req.user.sub]);
  if (!order.rowCount) throw new HttpError(404, 'Order was not found', 'order_not_found');
  if (!['paid','processing'].includes(order.rows[0].status)) throw new HttpError(409, 'This order is not ready for fulfillment', 'order_not_fulfillable');
  const items = await query(`select product_id as "productId",quantity,sku,title from order_items where order_id = $1`, [req.params.id]);
  const connector = await resolveConnector(req.context, 'fulfillment', req.body.connectorKey);
  const provider = await executeConnector({connector,operation:'createShipment',context:req.context,payload:{order:order.rows[0],items:items.rows,request:req.body}});
  const shipment = await withTenant(req.context.tenantId, async client => {
    const inserted = await client.query(`insert into shipments (tenant_id,order_id,carrier,tracking_number,status,events) values ($1,$2,$3,$4,$5,$6) returning id,carrier,tracking_number as "trackingNumber",status,events,created_at as "createdAt",updated_at as "updatedAt"`, [req.context.tenantId, req.params.id, provider.carrier || null, provider.trackingNumber || null, provider.status || 'label_created', JSON.stringify([{type:'label_created',at:new Date().toISOString()}])]);
    await client.query(`update orders set status = 'processing' where id = $1 and status = 'paid'`, [req.params.id]);
    await client.query(`insert into outbox_events (tenant_id,universe_id,event_type,aggregate_type,aggregate_id,payload) values ($1,$2,'shipment.created','shipment',$3,$4)`, [req.context.tenantId, req.context.universeId, inserted.rows[0].id, {shipmentId:inserted.rows[0].id,orderId:req.params.id}]);
    return inserted.rows[0];
  });
  res.status(201).json({data:shipment,connector:connector.connector_key});
}));
app.post('/api/orders/:id/cancel', requireAuth, asyncRoute(async (req, res) => {
  const result = await query(`update orders set status = 'cancelled', updated_at = now() where id = $1 and tenant_id = $2 and universe_id = $3 and user_id = $4 and status in ('pending_payment','paid','processing') returning id, order_number as "orderNumber", status`, [req.params.id, req.context.tenantId, req.context.universeId, req.user.sub]);
  if (!result.rowCount) throw new HttpError(409, 'This order cannot be cancelled', 'order_not_cancellable');
  await query(`insert into outbox_events (tenant_id, universe_id, event_type, aggregate_type, aggregate_id, payload) values ($1,$2,'order.cancel_requested','order',$3,$4)`, [req.context.tenantId, req.context.universeId, req.params.id, {orderId:req.params.id}]);
  res.json({data:result.rows[0]});
}));

app.post('/api/orders/:id/returns', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['reason','items']);
  const order = await query(`select id,status,created_at as "createdAt" from orders where id = $1 and tenant_id = $2 and universe_id = $3 and user_id = $4`, [req.params.id, req.context.tenantId, req.context.universeId, req.user.sub]);
  if (!order.rowCount) throw new HttpError(404, 'Order was not found', 'order_not_found');
  const policy = await resolveCommercePolicy(req.context, req.body.policyKey || 'commerce.return', {order:order.rows[0],reason:req.body.reason,requestType:'return'});
  if (!policy.eligible) throw new HttpError(409, 'This order is not eligible for return', policy.reason);
  const result = await query(`insert into return_requests (tenant_id,order_id,user_id,reason,items) values ($1,$2,$3,$4,$5) returning id,status,reason,items,created_at as "createdAt"`, [req.context.tenantId, req.params.id, req.user.sub, req.body.reason, req.body.items]);
  await query(`insert into outbox_events (tenant_id,universe_id,event_type,aggregate_type,aggregate_id,payload) values ($1,$2,'return.requested','return',$3,$4)`, [req.context.tenantId, req.context.universeId, result.rows[0].id, {returnId:result.rows[0].id, orderId:req.params.id}]);
  res.status(201).json({data:result.rows[0]});
}));

app.post('/api/orders/:id/exchanges', requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json({data:await createExchange(req.context, req.user, req.params.id, req.body)});
}));

app.get('/api/orders/:id/post-purchase-requests', requireAuth, asyncRoute(async (req, res) => {
  res.json({data:await listExchanges(req.context, req.user, req.params.id)});
}));

app.get('/api/post-purchase-requests', requireAuth, asyncRoute(async (req, res) => {
  res.json({data:await listExchanges(req.context, req.user)});
}));

app.post('/api/admin/post-purchase-requests/:id/transition', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  res.json({data:await transitionExchange(req.context, req.params.id, req.body)});
}));

app.post('/api/payments/intents', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['orderId']);
  const order = await query(`select id,total,currency,status from orders where id = $1 and tenant_id = $2 and universe_id = $3 and user_id = $4`, [req.body.orderId, req.context.tenantId, req.context.universeId, req.user.sub]);
  if (!order.rowCount) throw new HttpError(404, 'Order was not found', 'order_not_found');
  if (order.rows[0].status !== 'pending_payment') throw new HttpError(409, 'This order does not require payment', 'payment_not_required');
  const checkoutPolicy = await resolveConfiguration(req.context, 'checkout', 'pricing', manifestConfiguration('checkout', 'pricing', {}));
  const connector = await resolveConnector(req.context, checkoutPolicy.serviceType, req.body.connectorKey);
  const providerResult = await executeConnector({connector, operation:'createIntent', context:req.context, payload:{order:order.rows[0],request:req.body}});
  const result = await query(`insert into payment_intents (tenant_id,order_id,user_id,provider_connector_id,provider,provider_intent_id,amount,currency,status,metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,provider,provider_intent_id as "providerIntentId",amount,currency,status,metadata,created_at as "createdAt"`, [req.context.tenantId, req.body.orderId, req.user.sub, connector.id, connector.connector_key, providerResult.providerIntentId || null, order.rows[0].total, order.rows[0].currency, providerResult.status || 'requires_payment_method', providerResult.metadata || {}]);
  res.status(201).json({data:{...result.rows[0], clientSecret:providerResult.clientSecret, redirectUrl:providerResult.redirectUrl, connectorKey:connector.connector_key}});
}));

app.post('/api/payments/intents/:id/confirm', requireAuth, asyncRoute(async (req, res) => {
  const intent = await query(`select pi.id,pi.order_id as "orderId",pi.provider_intent_id as "providerIntentId",pi.amount,pi.currency,pi.status,pi.provider_connector_id as "providerConnectorId",pi.provider,sc.connector_key as "connectorKey",sc.adapter_module as "adapterModule",sc.config,sc.capabilities,sc.secret_ref as "secretRef",o.status as "orderStatus" from payment_intents pi join orders o on o.id = pi.order_id left join service_connectors sc on sc.id = pi.provider_connector_id where pi.id = $1 and pi.tenant_id = $2 and pi.user_id = $3`, [req.params.id, req.context.tenantId, req.user.sub]);
  if (!intent.rowCount) throw new HttpError(404, 'Payment intent was not found', 'payment_intent_not_found');
  if (intent.rows[0].status === 'succeeded') return res.json({data:intent.rows[0]});
  if (intent.rows[0].status !== 'requires_payment_method') throw new HttpError(409, 'Payment intent cannot be confirmed', 'payment_not_confirmable');
  const paymentResult = await executeConnector({connector:{id:intent.rows[0].providerConnectorId,connector_key:intent.rows[0].connectorKey,service_type:'payment',adapter_module:intent.rows[0].adapterModule,config:intent.rows[0].config,capabilities:intent.rows[0].capabilities,secret_ref:intent.rows[0].secretRef}, operation:'confirmIntent', context:req.context, payload:{paymentIntent:intent.rows[0],request:req.body}});
  const updated = await withTenant(req.context.tenantId, async client => {
    const changed = await client.query(`update payment_intents set status = $1,provider_reference = $2,metadata = metadata || $3::jsonb,updated_at = now() where id = $4 and status = 'requires_payment_method' returning id,order_id as "orderId",provider,provider_intent_id as "providerIntentId",provider_reference as "providerReference",amount,currency,status,metadata,created_at as "createdAt"`, [paymentResult.status, paymentResult.providerReference || null, JSON.stringify(paymentResult.metadata || {}), req.params.id]);
    if (!changed.rowCount) throw new HttpError(409, 'Payment intent was changed by another request', 'payment_version_conflict');
    if (paymentResult.status === 'succeeded') await client.query(`update orders set status = 'paid',payment_status = 'succeeded',payment_reference = $1,updated_at = now() where id = $2 and status = 'pending_payment'`, [paymentResult.providerReference || null, intent.rows[0].orderId]);
    await client.query(`insert into outbox_events (tenant_id,universe_id,event_type,aggregate_type,aggregate_id,payload) values ($1,$2,'payment.authorized','payment_intent',$3,$4)`, [req.context.tenantId, req.context.universeId, req.params.id, {paymentIntentId:req.params.id,orderId:intent.rows[0].orderId,status:paymentResult.status}]);
    return changed.rows[0];
  });
  res.json({data:updated});
}));

app.get('/api/registry/entity-types', requireAuth, asyncRoute(async (req, res) => {
  res.json({data:await listEntityTypes(req.context)});
}));

app.get('/api/entities/:entityType', requireAuth, asyncRoute(async (req, res) => {
  const type = await resolveEntityType(req.context, req.params.entityType);
  const result = await query(`select id,external_key as "externalKey",data,version,status,created_at as "createdAt",updated_at as "updatedAt" from entity_records where tenant_id = $1 and entity_type_id = $2 and (universe_id = $3 or universe_id is null) and status <> 'deleted' order by updated_at desc limit $4 offset $5`, [req.context.tenantId, type.id, req.context.universeId, Math.min(100, Number(req.query.pageSize || 50)), Math.max(0, (Number(req.query.page || 1) - 1) * Math.min(100, Number(req.query.pageSize || 50)))]);
  res.json({data:result.rows, entityType:{key:type.entity_key,displayName:type.display_name,schema:type.schema}, pagination:{page:Number(req.query.page || 1),pageSize:Math.min(100, Number(req.query.pageSize || 50))}});
}));

app.get('/api/entities/:entityType/:id', requireAuth, asyncRoute(async (req, res) => {
  const type = await resolveEntityType(req.context, req.params.entityType);
  const result = await query(`select id,external_key as "externalKey",data,version,status,created_at as "createdAt",updated_at as "updatedAt" from entity_records where id = $1 and tenant_id = $2 and entity_type_id = $3 and (universe_id = $4 or universe_id is null) and status <> 'deleted'`, [req.params.id, req.context.tenantId, type.id, req.context.universeId]);
  if (!result.rowCount) throw new HttpError(404, 'Entity record was not found', 'entity_not_found');
  res.json({data:result.rows[0],entityType:{key:type.entity_key,displayName:type.display_name,schema:type.schema}});
}));

app.post('/api/entities/:entityType', requireAuth, asyncRoute(async (req, res) => {
  const type = await resolveEntityType(req.context, req.params.entityType);
  assertEntityData(type, req.body.data || req.body);
  const data = req.body.data || req.body;
  const result = await query(`insert into entity_records (tenant_id,universe_id,entity_type_id,external_key,data,created_by) values ($1,$2,$3,$4,$5,$6) returning id,external_key as "externalKey",data,version,status,created_at as "createdAt",updated_at as "updatedAt"`, [req.context.tenantId, req.context.universeId, type.id, req.body.externalKey || null, data, req.user.sub]);
  res.status(201).json({data:result.rows[0]});
}));

app.patch('/api/entities/:entityType/:id', requireAuth, asyncRoute(async (req, res) => {
  const type = await resolveEntityType(req.context, req.params.entityType);
  const current = await query(`select data,version from entity_records where id = $1 and tenant_id = $2 and entity_type_id = $3 and (universe_id = $4 or universe_id is null) and status <> 'deleted'`, [req.params.id, req.context.tenantId, type.id, req.context.universeId]);
  if (!current.rowCount) throw new HttpError(404, 'Entity record was not found', 'entity_not_found');
  if (req.body.version !== undefined && Number(req.body.version) !== Number(current.rows[0].version)) throw new HttpError(409, 'Entity record was changed by another request', 'entity_version_conflict');
  const data = {...current.rows[0].data, ...(req.body.data || req.body)};
  assertEntityData(type, data);
  const result = await query(`update entity_records set data = $1, version = version + 1 where id = $2 and tenant_id = $3 and version = $4 returning id,external_key as "externalKey",data,version,status,created_at as "createdAt",updated_at as "updatedAt"`, [data, req.params.id, req.context.tenantId, current.rows[0].version]);
  if (!result.rowCount) throw new HttpError(409, 'Entity record was changed by another request', 'entity_version_conflict');
  res.json({data:result.rows[0]});
}));

app.get('/api/entities/:entityType/:id/relationships/:relationshipKey', requireAuth, asyncRoute(async (req, res) => {
  const sourceType = await resolveEntityType(req.context, req.params.entityType);
  const type = await resolveRelationshipType(req.context, req.params.relationshipKey);
  if (type.source_entity_key !== sourceType.entity_key && type.target_entity_key !== sourceType.entity_key) throw new HttpError(409, 'Relationship does not apply to this entity type', 'relationship_type_mismatch');
  const result = await query(`select er.id,er.external_key as "externalKey",er.data,er.version,er.status,rel.data as "relationshipData" from entity_relationships rel join entity_records er on er.id = case when rel.source_entity_id = $1 then rel.target_entity_id else rel.source_entity_id end where rel.tenant_id = $2 and rel.relationship_type_id = $3 and (rel.source_entity_id = $1 or rel.target_entity_id = $1)`, [req.params.id, req.context.tenantId, type.id]);
  res.json({data:result.rows});
}));

app.post('/api/entities/:entityType/:id/relationships/:relationshipKey', requireAuth, asyncRoute(async (req, res) => {
  const sourceType = await resolveEntityType(req.context, req.params.entityType);
  const relation = await resolveRelationshipType(req.context, req.params.relationshipKey);
  if (relation.source_entity_key !== sourceType.entity_key) throw new HttpError(409, 'Relationship source type does not match this entity type', 'relationship_type_mismatch');
  const source = await query(`select er.id from entity_records er where er.id = $1 and er.tenant_id = $2 and er.entity_type_id = $3 and er.status <> 'deleted'`, [req.params.id, req.context.tenantId, sourceType.id]);
  if (!source.rowCount) throw new HttpError(404, 'Source entity record was not found', 'entity_not_found');
  const target = await query(`select er.id from entity_records er join entity_types et on et.id = er.entity_type_id where er.id = $1 and er.tenant_id = $2 and et.entity_key = $3 and er.status <> 'deleted'`, [req.body.targetEntityId, req.context.tenantId, relation.target_entity_key]);
  if (!target.rowCount) throw new HttpError(404, 'Target entity record was not found', 'entity_not_found');
  const result = await query(`insert into entity_relationships (tenant_id,universe_id,relationship_type_id,source_entity_id,target_entity_id,data) values ($1,$2,$3,$4,$5,$6) on conflict (relationship_type_id,source_entity_id,target_entity_id) do update set data = excluded.data returning id,source_entity_id as "sourceEntityId",target_entity_id as "targetEntityId",data,created_at as "createdAt"`, [req.context.tenantId, req.context.universeId, relation.id, req.params.id, req.body.targetEntityId, req.body.data || {}]);
  res.status(201).json({data:result.rows[0]});
}));

app.get('/api/seller/products', requireAuth, requireRole('seller','admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select p.id, p.sku, p.title, p.price, p.status, i.available, i.reserved from products p left join inventory_items i on i.product_id = p.id and i.tenant_id = p.tenant_id and i.location_code = 'default' where p.tenant_id = $1 and p.universe_id = $2 and ($3 in ('admin','owner') or p.seller_id = (select id from seller_profiles where user_id = $4 and tenant_id = $1)) order by p.created_at desc`, [req.context.tenantId, req.context.universeId, req.user.role, req.user.sub]);
  res.json({data:result.rows.map(row => ({...row, price:Number(row.price), available:Number(row.available || 0), reserved:Number(row.reserved || 0)}))});
}));

app.post('/api/seller/onboarding', requireAuth, asyncRoute(async (req, res) => {
  requireBody(req.body, ['displayName']);
  const result = await query(`insert into seller_profiles (tenant_id,user_id,display_name,compliance) values ($1,$2,$3,$4) on conflict (tenant_id,user_id) do update set display_name = excluded.display_name, compliance = excluded.compliance returning id,display_name,status,compliance`, [req.context.tenantId, req.user.sub, req.body.displayName, req.body.compliance || {}]);
  await query(`update tenant_memberships set role = 'seller' where tenant_id = $1 and user_id = $2 and role = 'customer'`, [req.context.tenantId, req.user.sub]);
  await query(`insert into outbox_events (tenant_id,universe_id,event_type,aggregate_type,aggregate_id,payload) values ($1,$2,'seller.onboarding','seller',$3,$4)`, [req.context.tenantId, req.context.universeId, result.rows[0].id, {sellerId:result.rows[0].id, userId:req.user.sub}]);
  res.status(201).json({data:result.rows[0]});
}));

app.get('/api/admin/feature-flags', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select key,enabled,config,effective_from as "effectiveFrom",effective_until as "effectiveUntil" from feature_flags where tenant_id = $1 and (universe_id = $2 or universe_id is null) order by key`, [req.context.tenantId, req.context.universeId]);
  res.json({data:result.rows});
}));

app.get('/api/admin/audit-events', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const {page,pageSize,offset} = pageParams(req.query, {page:1,pageSize:50,maxPageSize:200});
  const result = await query(`select id,actor_id as "actorId",action,resource_type as "resourceType",resource_id as "resourceId",metadata,created_at as "createdAt" from audit_events where tenant_id = $1 order by created_at desc limit $2 offset $3`, [req.context.tenantId,pageSize,offset]);
  res.json({data:result.rows,pagination:{page,pageSize}});
}));

app.get('/api/admin/connectors/:serviceType', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select id,service_type as "serviceType",universe_id as "universeId",connector_key as "connectorKey",adapter_module as "adapterModule",enabled,priority,regions,country_codes as "countryCodes",currencies,locales,channels,capabilities,config,secret_ref is not null as "secretConfigured",effective_from as "effectiveFrom",effective_until as "effectiveUntil" from service_connectors where tenant_id = $1 and service_type = $2 order by priority, connector_key`, [req.context.tenantId, req.params.serviceType]);
  res.json({data:result.rows});
}));

app.put('/api/admin/connectors/:serviceType/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['adapterModule']);
   const universeId = req.body.universeId || req.context.universeId;
   const credentials = req.body.credentials ?? (req.body.apiKey ? {apiKey:req.body.apiKey} : undefined);
   const secretRef = credentials === undefined ? (req.body.secretRef || null) : 'database';
   const result = await query(`insert into service_connectors (tenant_id,service_type,universe_id,connector_key,adapter_module,enabled,priority,regions,country_codes,currencies,locales,channels,capabilities,config,secret_ref,effective_until) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict (tenant_id,service_type,universe_id,connector_key) do update set adapter_module = excluded.adapter_module,enabled = excluded.enabled,priority = excluded.priority,regions = excluded.regions,country_codes = excluded.country_codes,currencies = excluded.currencies,locales = excluded.locales,channels = excluded.channels,capabilities = excluded.capabilities,config = excluded.config,secret_ref = coalesce(excluded.secret_ref,service_connectors.secret_ref),effective_until = excluded.effective_until returning id,service_type as "serviceType",universe_id as "universeId",connector_key as "connectorKey",adapter_module as "adapterModule",enabled,priority,regions,country_codes as "countryCodes",currencies,locales,channels,capabilities,config,secret_ref is not null as "secretConfigured",effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [req.context.tenantId, req.params.serviceType, universeId, req.params.key, req.body.adapterModule, req.body.enabled !== false, Number(req.body.priority || 100), JSON.stringify(req.body.regions || []), JSON.stringify(req.body.countryCodes || []), JSON.stringify(req.body.currencies || []), JSON.stringify(req.body.locales || []), JSON.stringify(req.body.channels || []), req.body.capabilities || {}, req.body.config || {}, secretRef, req.body.effectiveUntil || null]);
   if (credentials !== undefined) await saveConnectorSecret({tenantId:req.context.tenantId,universeId,serviceType:req.params.serviceType,connectorKey:req.params.key,value:credentials,actorId:req.user.sub});
  await query(`insert into audit_events (tenant_id,actor_id,action,resource_type,resource_id,metadata) values ($1,$2,'connector.updated','service_connector',$3,$4)`, [req.context.tenantId, req.user.sub, result.rows[0].id, {serviceType:req.params.serviceType,connectorKey:req.params.key}]);
  res.json({data:result.rows[0]});
}));
app.post('/api/admin/connectors/:serviceType/:key/test', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['operation']);
  const connector = await resolveConnector({...req.context, universeId:req.body.universeId || req.context.universeId}, req.params.serviceType, req.params.key);
  const result = await executeConnector({connector,operation:req.body.operation,context:req.context,payload:req.body.payload || {}});
  res.json({data:{ok:true,operation:req.body.operation,result}});
}));

app.delete('/api/admin/connectors/:serviceType/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`update service_connectors set enabled = false where tenant_id = $1 and service_type = $2 and connector_key = $3 returning id,service_type as "serviceType",connector_key as "connectorKey",enabled`, [req.context.tenantId, req.params.serviceType, req.params.key]);
  if (!result.rowCount) throw new HttpError(404, 'Connector was not found', 'connector_not_found');
  res.json({data:result.rows[0]});
}));

app.get('/api/admin/runtime-config/:namespace/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select namespace,config_key as "key",value,version,effective_from as "effectiveFrom",effective_until as "effectiveUntil" from runtime_config where tenant_id = $1 and universe_id = $2 and namespace = $3 and config_key = $4`, [req.context.tenantId, req.context.universeId, req.params.namespace, req.params.key]);
  res.json({data:result.rows[0] || {namespace:req.params.namespace,key:req.params.key,value:manifestConfiguration(req.params.namespace, req.params.key, {}),source:'manifest-default'}});
}));

app.put('/api/admin/runtime-config/:namespace/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['value']);
  const result = await query(`insert into runtime_config (tenant_id,universe_id,namespace,config_key,value,version,effective_until) values ($1,$2,$3,$4,$5,1,$6) on conflict (tenant_id,universe_id,namespace,config_key) do update set value = excluded.value, version = runtime_config.version + 1, effective_until = excluded.effective_until returning namespace,config_key as "key",value,version,effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [req.context.tenantId, req.context.universeId, req.params.namespace, req.params.key, req.body.value, req.body.effectiveUntil || null]);
  await query(`insert into audit_events (tenant_id,actor_id,action,resource_type,resource_id,metadata) values ($1,$2,'runtime_config.updated','runtime_config',$3,$4)`, [req.context.tenantId, req.user.sub, `${req.params.namespace}.${req.params.key}`, {version:result.rows[0].version}]);
  res.json({data:result.rows[0]});
}));

app.get('/api/admin/configuration/:namespace/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select id,scope_type as "scopeType",scope_key as "scopeKey",namespace,config_key as "key",value,version,effective_from as "effectiveFrom",effective_until as "effectiveUntil" from configuration_entries where namespace = $1 and config_key = $2 order by scope_type,scope_key`, [req.params.namespace, req.params.key]);
  res.json({data:result.rows});
}));

app.put('/api/admin/configuration/:namespace/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['scopeType','scopeKey','value']);
  const result = await query(`insert into configuration_entries (scope_type,scope_key,namespace,config_key,value,effective_until) values ($1,$2,$3,$4,$5,$6) on conflict (scope_type,scope_key,namespace,config_key) do update set value = excluded.value,version = configuration_entries.version + 1,effective_until = excluded.effective_until returning id,scope_type as "scopeType",scope_key as "scopeKey",namespace,config_key as "key",value,version,effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [req.body.scopeType, req.body.scopeKey, req.params.namespace, req.params.key, req.body.value, req.body.effectiveUntil || null]);
  await query(`insert into audit_events (tenant_id,actor_id,action,resource_type,resource_id,metadata) values ($1,$2,'configuration.updated','configuration',$3,$4)`, [req.context.tenantId, req.user.sub, result.rows[0].id, {scopeType:req.body.scopeType,scopeKey:req.body.scopeKey,namespace:req.params.namespace,key:req.params.key}]);
  res.json({data:result.rows[0]});
}));

app.get('/api/admin/topology/planes', requireAuth, requireRole('admin','owner'), asyncRoute(async (_req, res) => {
  const result = await query(`select id,plane_key as "planeKey",adapter_module as "adapterModule",topology,capacity,status,created_at as "createdAt",updated_at as "updatedAt" from data_planes order by plane_key`);
  res.json({data:result.rows});
}));

app.put('/api/admin/topology/planes/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
   const result = await query(`insert into data_planes (plane_key,adapter_module,endpoint_secret_ref,topology,capacity,status) values ($1,$2,$3,$4,$5,$6) on conflict (plane_key) do update set adapter_module = excluded.adapter_module,endpoint_secret_ref = coalesce(excluded.endpoint_secret_ref,data_planes.endpoint_secret_ref),topology = excluded.topology,capacity = excluded.capacity,status = excluded.status returning id,plane_key as "planeKey",adapter_module as "adapterModule",topology,capacity,status`, [req.params.key, req.body.adapterModule || 'configured-storage', req.body.endpointSecretRef || null, req.body.topology || {}, req.body.capacity || {}, req.body.status || 'active']);
  res.json({data:result.rows[0]});
}));

app.put('/api/admin/topology/routes', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['tenantId','dataPlaneId','shardKey']);
  const result = await query(`insert into tenant_data_routes (tenant_id,universe_id,data_plane_id,shard_key,weight,effective_until) values ($1,$2,$3,$4,$5,$6) on conflict (tenant_id,universe_id,shard_key) do update set data_plane_id = excluded.data_plane_id,weight = excluded.weight,effective_until = excluded.effective_until returning tenant_id as "tenantId",universe_id as "universeId",data_plane_id as "dataPlaneId",shard_key as "shardKey",weight,effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [req.body.tenantId, req.body.universeId || null, req.body.dataPlaneId, req.body.shardKey, Number(req.body.weight || 100), req.body.effectiveUntil || null]);
  res.json({data:result.rows[0]});
}));

app.post('/api/admin/feature-flags', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['key','enabled']);
  const result = await query(`insert into feature_flags (tenant_id, universe_id, key, enabled, config) values ($1,$2,$3,$4,$5) on conflict (tenant_id, universe_id, key) do update set enabled = excluded.enabled, config = excluded.config returning tenant_id, universe_id, key, enabled, config`, [req.context.tenantId, req.context.universeId, req.body.key, Boolean(req.body.enabled), req.body.config || {}]);
  await query(`insert into audit_events (tenant_id, actor_id, action, resource_type, resource_id, metadata) values ($1,$2,'feature_flag.updated','feature_flag',$3,$4)`, [req.context.tenantId, req.user.sub, req.body.key, {enabled:Boolean(req.body.enabled)}]);
  res.json({data:result.rows[0]});
}));

app.put('/api/admin/registry/entity-types/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['displayName','schema']);
  const result = await query(`insert into entity_types (tenant_id,universe_id,entity_key,display_name,schema,capabilities,lifecycle,version,status) values ($1,$2,$3,$4,$5,$6,$7,1,$8) on conflict (tenant_id,universe_id,entity_key) do update set display_name = excluded.display_name,schema = excluded.schema,capabilities = excluded.capabilities,lifecycle = excluded.lifecycle,version = entity_types.version + 1,status = excluded.status returning id,universe_id as "universeId",entity_key as "entityKey",display_name as "displayName",schema,capabilities,lifecycle,version,status`, [req.context.tenantId, req.body.universeId || req.context.universeId, req.params.key, req.body.displayName, req.body.schema, req.body.capabilities || {}, req.body.lifecycle || {}, req.body.status || 'active']);
  await query(`insert into audit_events (tenant_id,actor_id,action,resource_type,resource_id,metadata) values ($1,$2,'entity_type.updated','entity_type',$3,$4)`, [req.context.tenantId, req.user.sub, result.rows[0].id, {entityKey:req.params.key,version:result.rows[0].version}]);
  res.json({data:result.rows[0]});
}));

app.get('/api/admin/registry/relationship-types', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select id,universe_id as "universeId",relationship_key as "relationshipKey",source_entity_key as "sourceEntityKey",target_entity_key as "targetEntityKey",cardinality,config,status from relationship_types where tenant_id = $1 and (universe_id = $2 or universe_id is null) order by relationship_key`, [req.context.tenantId, req.context.universeId]);
  res.json({data:result.rows});
}));

app.put('/api/admin/registry/relationship-types/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['sourceEntityKey','targetEntityKey']);
  const result = await query(`insert into relationship_types (tenant_id,universe_id,relationship_key,source_entity_key,target_entity_key,cardinality,config,status) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (tenant_id,universe_id,relationship_key) do update set source_entity_key = excluded.source_entity_key,target_entity_key = excluded.target_entity_key,cardinality = excluded.cardinality,config = excluded.config,status = excluded.status returning id,universe_id as "universeId",relationship_key as "relationshipKey",source_entity_key as "sourceEntityKey",target_entity_key as "targetEntityKey",cardinality,config,status`, [req.context.tenantId, req.body.universeId || req.context.universeId, req.params.key, req.body.sourceEntityKey, req.body.targetEntityKey, req.body.cardinality || 'many_to_many', req.body.config || {}, req.body.status || 'active']);
  res.json({data:result.rows[0]});
}));

app.get('/api/admin/registry/workflows', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select id,universe_id as "universeId",workflow_key as "workflowKey",workflow_type as "workflowType",task_queue as "taskQueue",trigger_events as "triggerEvents",signals,retry_policy as "retryPolicy",input_schema as "inputSchema",enabled,version,effective_from as "effectiveFrom",effective_until as "effectiveUntil" from workflow_definitions where tenant_id = $1 and (universe_id = $2 or universe_id is null) order by workflow_key,version desc`, [req.context.tenantId, req.context.universeId]);
  res.json({data:result.rows});
}));

app.put('/api/admin/registry/workflows/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['workflowType','taskQueue','triggerEvents']);
  const result = await query(`insert into workflow_definitions (tenant_id,universe_id,workflow_key,workflow_type,task_queue,trigger_events,signals,retry_policy,input_schema,enabled,version,effective_until) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11) on conflict (tenant_id,universe_id,workflow_key,version) do update set workflow_type = excluded.workflow_type,task_queue = excluded.task_queue,trigger_events = excluded.trigger_events,signals = excluded.signals,retry_policy = excluded.retry_policy,input_schema = excluded.input_schema,enabled = excluded.enabled,effective_until = excluded.effective_until returning id,universe_id as "universeId",workflow_key as "workflowKey",workflow_type as "workflowType",task_queue as "taskQueue",trigger_events as "triggerEvents",signals,retry_policy as "retryPolicy",input_schema as "inputSchema",enabled,version,effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [req.context.tenantId, req.body.universeId || req.context.universeId, req.params.key, req.body.workflowType, req.body.taskQueue, req.body.triggerEvents, req.body.signals || [], req.body.retryPolicy || {}, req.body.inputSchema || {}, req.body.enabled !== false, req.body.effectiveUntil || null]);
  res.json({data:result.rows[0]});
}));

app.put('/api/admin/registry/policies/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['policyType','definition']);
  const result = await query(`insert into policy_definitions (tenant_id,universe_id,policy_key,policy_type,definition,enabled) values ($1,$2,$3,$4,$5,$6) returning id,universe_id as "universeId",policy_key as "policyKey",policy_type as "policyType",definition,version,enabled,effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [req.context.tenantId, req.body.universeId || req.context.universeId, req.params.key, req.body.policyType, req.body.definition, req.body.enabled !== false]);
  res.json({data:result.rows[0]});
}));

app.get('/api/admin/registry/commands', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select id,universe_id as "universeId",command_key as "commandKey",entity_type_key as "entityTypeKey",operation,workflow_key as "workflowKey",input_schema as "inputSchema",allowed_roles as "allowedRoles",idempotent,enabled,version,effective_from as "effectiveFrom",effective_until as "effectiveUntil" from command_definitions where tenant_id = $1 and (universe_id = $2 or universe_id is null) order by command_key,version desc`, [req.context.tenantId, req.context.universeId]);
  res.json({data:result.rows});
}));

app.put('/api/admin/registry/commands/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['operation']);
  const result = await query(`insert into command_definitions (tenant_id,universe_id,command_key,entity_type_key,operation,workflow_key,input_schema,allowed_roles,idempotent,enabled) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (tenant_id,universe_id,command_key,version) do update set entity_type_key = excluded.entity_type_key,operation = excluded.operation,workflow_key = excluded.workflow_key,input_schema = excluded.input_schema,allowed_roles = excluded.allowed_roles,idempotent = excluded.idempotent,enabled = excluded.enabled returning id,universe_id as "universeId",command_key as "commandKey",entity_type_key as "entityTypeKey",operation,workflow_key as "workflowKey",input_schema as "inputSchema",allowed_roles as "allowedRoles",idempotent,enabled,version,effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [req.context.tenantId, req.body.universeId || req.context.universeId, req.params.key, req.body.entityTypeKey || null, req.body.operation, req.body.workflowKey || null, req.body.inputSchema || {}, req.body.allowedRoles || [], req.body.idempotent !== false, req.body.enabled !== false]);
  res.json({data:result.rows[0]});
}));

app.get('/api/admin/registry/state-machines', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select id,universe_id as "universeId",state_machine_key as "stateMachineKey",initial_state as "initialState",states,transitions,version,enabled,effective_from as "effectiveFrom",effective_until as "effectiveUntil" from state_machine_definitions where tenant_id = $1 and (universe_id = $2 or universe_id is null) order by state_machine_key,version desc`, [req.context.tenantId, req.context.universeId]);
  res.json({data:result.rows});
}));

app.put('/api/admin/registry/state-machines/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['initialState','states','transitions']);
  const result = await query(`insert into state_machine_definitions (tenant_id,universe_id,state_machine_key,initial_state,states,transitions,enabled) values ($1,$2,$3,$4,$5,$6,$7) on conflict (tenant_id,universe_id,state_machine_key,version) do update set initial_state = excluded.initial_state,states = excluded.states,transitions = excluded.transitions,enabled = excluded.enabled returning id,universe_id as "universeId",state_machine_key as "stateMachineKey",initial_state as "initialState",states,transitions,version,enabled,effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [req.context.tenantId, req.body.universeId || req.context.universeId, req.params.key, req.body.initialState, req.body.states, req.body.transitions, req.body.enabled !== false]);
  res.json({data:result.rows[0]});
}));

app.get('/api/admin/modules', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select id,module_key as "moduleKey",universe_id as "universeId",display_name as "displayName",labels,capabilities,entities,config,units,enabled,version,effective_from as "effectiveFrom",effective_until as "effectiveUntil" from module_definitions where tenant_id = $1 and (universe_id = $2 or universe_id is null) order by module_key`, [req.context.tenantId, req.context.universeId]);
  res.json({data:result.rows});
}));

app.get('/api/admin/capability-bundles', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  res.json({data:await listBundles(req.context)});
}));

app.post('/api/admin/capability-bundles', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const result = await registerCapabilityBundle(req.context, req.user, req.body);
  res.status(201).json({data:result});
}));

app.get('/api/admin/experience', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const value = await resolveConfiguration(req.context, 'experience', 'default', manifestConfiguration('experience', 'default', {}));
  res.json({data:value});
}));

app.put('/api/admin/experience', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['scopeType','scopeKey','value']);
  const result = await query(`insert into configuration_entries (scope_type,scope_key,namespace,config_key,value) values ($1,$2,'experience','default',$3) on conflict (scope_type,scope_key,namespace,config_key) do update set value = excluded.value,version = configuration_entries.version + 1 returning id,scope_type as "scopeType",scope_key as "scopeKey",value,version`, [req.body.scopeType, req.body.scopeKey, req.body.value]);
  await query(`insert into audit_events (tenant_id,actor_id,action,resource_type,resource_id,metadata) values ($1,$2,'experience.updated','experience',$3,$4)`, [req.context.tenantId, req.user.sub, result.rows[0].id, {scopeType:req.body.scopeType,scopeKey:req.body.scopeKey}]);
  res.json({data:result.rows[0]});
}));

app.put('/api/admin/modules/:moduleKey', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['displayName','capabilities']);
  const result = await query(`insert into module_definitions (tenant_id,universe_id,module_key,display_name,labels,capabilities,entities,config,units,enabled) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (tenant_id,universe_id,module_key) do update set display_name = excluded.display_name,labels = excluded.labels,capabilities = excluded.capabilities,entities = excluded.entities,config = excluded.config,units = excluded.units,enabled = excluded.enabled,version = module_definitions.version + 1 returning id,module_key as "moduleKey",universe_id as "universeId",display_name as "displayName",labels,capabilities,entities,config,units,enabled,version,effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [req.context.tenantId, req.body.universeId || req.context.universeId, req.params.moduleKey, req.body.displayName, req.body.labels || {}, req.body.capabilities, req.body.entities || [], req.body.config || {}, req.body.units || [], req.body.enabled !== false]);
  await query(`insert into audit_events (tenant_id,actor_id,action,resource_type,resource_id,metadata) values ($1,$2,'module.updated','module',$3,$4)`, [req.context.tenantId, req.user.sub, result.rows[0].id, {moduleKey:req.params.moduleKey,version:result.rows[0].version}]);
  res.json({data:result.rows[0]});
}));

app.put('/api/admin/modules/:moduleKey/conversions', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['fromUnit','toUnit','rate']);
  const result = await query(`insert into conversion_rules (tenant_id,universe_id,module_key,from_unit,to_unit,rate,rounding_mode,decimal_places,fee,config,effective_until) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (tenant_id,universe_id,module_key,from_unit,to_unit,effective_from) do update set rate = excluded.rate,rounding_mode = excluded.rounding_mode,decimal_places = excluded.decimal_places,fee = excluded.fee,config = excluded.config,effective_until = excluded.effective_until returning id,module_key as "moduleKey",universe_id as "universeId",from_unit as "fromUnit",to_unit as "toUnit",rate,rounding_mode as "roundingMode",decimal_places as "decimalPlaces",fee,config,effective_from as "effectiveFrom",effective_until as "effectiveUntil"`, [req.context.tenantId, req.body.universeId || req.context.universeId, req.params.moduleKey, req.body.fromUnit, req.body.toUnit, req.body.rate, req.body.roundingMode || 'half_up', Number(req.body.decimalPlaces ?? 2), Number(req.body.fee || 0), req.body.config || {}, req.body.effectiveUntil || null]);
  res.json({data:result.rows[0]});
}));

app.get('/api/admin/catalog/product-types', requireAuth, requireRole('seller','admin','owner'), asyncRoute(async (req, res) => {
  const result = await query(`select id,type_key as "typeKey",universe_id as "universeId",display_name as "displayName",schema,capabilities,fulfillment_modes as "fulfillmentModes",compliance,version,enabled from product_type_definitions where tenant_id = $1 and (universe_id = $2 or universe_id is null) order by type_key`, [req.context.tenantId, req.context.universeId]);
  res.json({data:result.rows});
}));

app.put('/api/admin/catalog/product-types/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['displayName','schema','capabilities']);
  const result = await query(`insert into product_type_definitions (tenant_id,universe_id,type_key,display_name,schema,capabilities,fulfillment_modes,compliance,enabled) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (tenant_id,universe_id,type_key) do update set display_name = excluded.display_name,schema = excluded.schema,capabilities = excluded.capabilities,fulfillment_modes = excluded.fulfillment_modes,compliance = excluded.compliance,enabled = excluded.enabled,version = product_type_definitions.version + 1 returning id,type_key as "typeKey",universe_id as "universeId",display_name as "displayName",schema,capabilities,fulfillment_modes as "fulfillmentModes",compliance,version,enabled`, [req.context.tenantId, req.body.universeId || req.context.universeId, req.params.key, req.body.displayName, req.body.schema, req.body.capabilities, req.body.fulfillmentModes || [], req.body.compliance || {}, req.body.enabled !== false]);
  res.json({data:result.rows[0]});
}));

// Storage resources are the portable equivalent of an administrator-created
// table. Each adapter decides whether it materializes the definition as rows,
// documents, keys, vertices, or indexed records.
app.get('/api/admin/storage/adapters', requireAuth, requireRole('admin','owner'), asyncRoute(async (_req, res) => {
  res.json({data:{selected:config.storageAdapter, capabilities, available:[
    {key:'postgres',model:'relational',module:'server/storage/postgres.js'},
    {key:'document',model:'document',module:'server/storage/document.js'},
    {key:'keyvalue',model:'keyvalue',module:'server/storage/keyvalue.js'},
    {key:'graph',model:'graph',module:'server/storage/graph.js'},
    {key:'search',model:'search',module:'server/storage/search.js'},
    {key:'vector',model:'vector',module:'server/storage/vector.js'}
  ]}});
}));

app.get('/api/admin/storage/resources', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  res.json({data:await resources.listDefinitions(req.context)});
}));

app.put('/api/admin/storage/resources/:key', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['displayName']);
  const resource = await resources.define(req.context, req.params.key, req.body);
  res.json({data:resource});
}));

app.get('/api/admin/storage/resources/:key/records', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  let filter;
  if (req.query.filter) { try { filter = JSON.parse(req.query.filter); } catch { throw new HttpError(400, 'filter must be valid JSON', 'invalid_resource_filter'); } }
  res.json({data:await resources.listRecords(req.context, req.params.key, {page:req.query.page,pageSize:req.query.pageSize,filter})});
}));

app.post('/api/admin/storage/resources/:key/records', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const record = await resources.createRecord(req.context, req.params.key, req.body.data || req.body, req.user.sub);
  res.status(201).json({data:record});
}));

app.patch('/api/admin/storage/resources/:key/records/:id', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const record = await resources.updateRecord(req.context, req.params.key, req.params.id, req.body.data || req.body, req.body.version);
  if (!record) throw new HttpError(404, 'Resource record was not found', 'resource_record_not_found');
  res.json({data:record});
}));

app.delete('/api/admin/storage/resources/:key/records/:id', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  const record = await resources.deleteRecord(req.context, req.params.key, req.params.id);
  if (!record) throw new HttpError(404, 'Resource record was not found', 'resource_record_not_found');
  res.json({data:record});
}));

app.post('/api/admin/storage/links', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  requireBody(req.body, ['type','fromResourceKey','fromId','toResourceKey','toId']);
  res.status(201).json({data:await resources.link(req.context, req.body)});
}));

app.get('/api/admin/storage/links/:id', requireAuth, requireRole('admin','owner'), asyncRoute(async (req, res) => {
  res.json({data:await resources.links(req.context, req.params.id, req.query.type)});
}));

const frontendPath = path.join(here, '..', 'dist');
const adminPath = path.join(here, '..', 'admin');
if (fs.existsSync(adminPath)) {
  app.use('/admin', express.static(adminPath));
  app.get('/admin', (_req, res) => res.sendFile(path.join(adminPath, 'index.html')));
}
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath, {index:'index.html', maxAge:'1h'}));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !path.extname(req.path)) return res.sendFile(path.join(frontendPath, 'index.html'));
    next();
  });
}

app.use((error, req, res, _next) => {
  const databaseUnavailable = ['ECONNREFUSED','ECONNRESET','08001','08003','57P01'].includes(error.code);
  const status = error.status || (databaseUnavailable ? 503 : error.code === '23505' ? 409 : 500);
  if (status >= 500) console.error(`[${req.requestId}]`, error);
  res.status(status).json({error:{code:databaseUnavailable ? 'storage_unavailable' : error.code || 'internal_error', message:error instanceof HttpError ? error.message : (databaseUnavailable ? 'The configured storage provider is unavailable. Check its deployment and configuration.' : status >= 500 ? 'An unexpected server error occurred' : error.message), details:error.details, requestId:req.requestId}});
});

export default app;
