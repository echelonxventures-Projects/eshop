import {query} from './db.js';
import {HttpError} from './http.js';

export async function resolveProductType(context, typeKey) {
  const result = await query(`select * from product_type_definitions where tenant_id = $1 and type_key = $2 and enabled = true and (universe_id = $3 or universe_id is null) order by case when universe_id = $3 then 0 else 1 end, version desc limit 1`, [context.tenantId, typeKey, context.universeId]);
  if (!result.rowCount) throw new HttpError(422, `Product type is not configured: ${typeKey}`, 'product_type_not_configured');
  return result.rows[0];
}

function schemaTypeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validateSchema(value, schema, path) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type && !schemaTypeMatches(value, schema.type)) throw new HttpError(400, `${path} must be a ${schema.type}`, 'product_type_validation_error');
  if (schema.enum && !schema.enum.some(option => JSON.stringify(option) === JSON.stringify(value))) throw new HttpError(400, `${path} must be one of: ${schema.enum.join(', ')}`, 'product_type_validation_error');
  if (schema.minLength !== undefined && String(value).length < Number(schema.minLength)) throw new HttpError(400, `${path} is too short`, 'product_type_validation_error');
  if (schema.minimum !== undefined && Number(value) < Number(schema.minimum)) throw new HttpError(400, `${path} is below the minimum`, 'product_type_validation_error');
  if (schema.type === 'object') {
    for (const required of schema.required || []) if (value[required] === undefined || value[required] === null) throw new HttpError(400, `${path}.${required} is required`, 'product_type_validation_error');
    for (const [key, child] of Object.entries(schema.properties || {})) if (value[key] !== undefined && value[key] !== null) validateSchema(value[key], child, `${path}.${key}`);
  }
  if (schema.type === 'array' && schema.items) for (const [index, item] of value.entries()) validateSchema(item, schema.items, `${path}[${index}]`);
}

export function validateProductType(type, input = {}) {
  validateSchema(input, type.schema || {}, 'attributes');
  const modes = Array.isArray(type.fulfillment_modes) ? type.fulfillment_modes : [];
  if (input.fulfillmentMode && modes.length && !modes.includes(input.fulfillmentMode)) throw new HttpError(422, 'Fulfillment mode is not supported for this product type', 'fulfillment_mode_not_supported');
}

export async function listProductTypes(context) {
  const result = await query(`select type_key as "typeKey",display_name as "displayName",schema,capabilities,fulfillment_modes as "fulfillmentModes",compliance,version from product_type_definitions where tenant_id = $1 and (universe_id = $2 or universe_id is null) and enabled = true order by type_key`, [context.tenantId, context.universeId]);
  return result.rows;
}

export async function listOffers(context, productId) {
  const result = await query(`select o.id,o.offer_key as "offerKey",o.variant_id as "variantId",o.seller_id as "sellerId",o.price,o.currency,o.compare_at_price as "compareAtPrice",o.condition,o.fulfillment_mode as "fulfillmentMode",o.promise,o.promotions,o.status,o.effective_from as "effectiveFrom",o.effective_until as "effectiveUntil",p.title from product_offers o join products p on p.id = o.product_id where o.tenant_id = $1 and o.universe_id = $2 and o.product_id = $3 and o.status = 'active' and o.effective_from <= now() and (o.effective_until is null or o.effective_until > now()) order by o.price asc`, [context.tenantId, context.universeId, productId]);
  return result.rows.map(row => ({...row,price:Number(row.price),compareAtPrice:row.compareAtPrice === null ? null : Number(row.compareAtPrice)}));
}

export async function createCatalogProduct(context, input, actor) {
  if (!input.typeKey || !input.sku || !input.slug || !input.title || input.price === undefined) throw new HttpError(400, 'typeKey, sku, slug, title, and price are required', 'catalog_validation_error');
  const type = await resolveProductType(context, input.typeKey);
  validateProductType(type, {...(input.attributes || {}), fulfillmentMode:input.fulfillmentMode});
  let sellerId = input.sellerId || null;
  if (actor && !['admin','owner'].includes(actor.role)) {
    const seller = await query(`select id from seller_profiles where tenant_id = $1 and user_id = $2 and status in ('pending','approved')`, [context.tenantId, actor.sub]);
    if (!seller.rowCount) throw new HttpError(422, 'Complete seller onboarding before creating a product', 'seller_profile_required');
    sellerId = seller.rows[0].id;
  }
  const result = await query(`insert into products (tenant_id,universe_id,seller_id,product_type_key,category_id,sku,slug,title,description,media,attributes,price,currency,compare_at_price,brand,tax_code,fulfillment_config,compliance_data,seo) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id,product_type_key as "typeKey",sku,slug,title,description,media,attributes,price,currency,compare_at_price as "compareAtPrice",brand,tax_code as "taxCode",fulfillment_config as "fulfillmentConfig",compliance_data as "complianceData",seo,status,created_at as "createdAt"`, [context.tenantId, context.universeId, sellerId, input.typeKey, input.categoryId || null, input.sku, input.slug, input.title, input.description || '', input.media || [], input.attributes || {}, input.price, input.currency || context.currency, input.compareAtPrice || null, input.brand || null, input.taxCode || null, input.fulfillmentConfig || {}, input.complianceData || {}, input.seo || {}]);
  return {...result.rows[0],price:Number(result.rows[0].price),compareAtPrice:result.rows[0].compareAtPrice === null ? null : Number(result.rows[0].compareAtPrice)};
}

export async function updateCatalogProduct(context, input, actor, productId) {
  const current = await query(`select p.*,s.user_id as seller_user_id from products p left join seller_profiles s on s.id = p.seller_id where p.id = $1 and p.tenant_id = $2 and p.universe_id = $3`, [productId, context.tenantId, context.universeId]);
  if (!current.rowCount) throw new HttpError(404, 'Product was not found', 'product_not_found');
  const product = current.rows[0];
  if (actor && !['admin','owner'].includes(actor.role) && product.seller_user_id !== actor.sub) throw new HttpError(403, 'You cannot update this product', 'product_forbidden');
  const type = await resolveProductType(context, input.typeKey || product.product_type_key);
  const attributes = input.attributes === undefined ? (product.attributes || {}) : input.attributes;
  validateProductType(type, {...attributes, fulfillmentMode:input.fulfillmentMode || product.fulfillment_config?.mode});
  const result = await query(`update products set product_type_key = $1,category_id = coalesce($2,category_id),title = coalesce($3,title),description = coalesce($4,description),media = coalesce($5,media),attributes = $6,price = coalesce($7,price),currency = coalesce($8,currency),compare_at_price = coalesce($9,compare_at_price),brand = coalesce($10,brand),tax_code = coalesce($11,tax_code),fulfillment_config = coalesce($12,fulfillment_config),compliance_data = coalesce($13,compliance_data),seo = coalesce($14,seo),status = coalesce($15,status),updated_at = now() where id = $16 and tenant_id = $17 and universe_id = $18 returning id,product_type_key as "typeKey",sku,slug,title,description,media,attributes,price,currency,compare_at_price as "compareAtPrice",brand,tax_code as "taxCode",fulfillment_config as "fulfillmentConfig",compliance_data as "complianceData",seo,status,created_at as "createdAt",updated_at as "updatedAt"`, [type.type_key, input.categoryId || null, input.title, input.description, input.media, attributes, input.price, input.currency, input.compareAtPrice, input.brand, input.taxCode, input.fulfillmentConfig, input.complianceData, input.seo, input.status, productId, context.tenantId, context.universeId]);
  return {...result.rows[0],price:Number(result.rows[0].price),compareAtPrice:result.rows[0].compareAtPrice === null ? null : Number(result.rows[0].compareAtPrice)};
}
