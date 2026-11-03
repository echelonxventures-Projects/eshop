create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists tenants (
  id text primary key,
  name text not null,
  region text not null,
  country_code char(2) not null default 'US',
  default_currency char(3) not null,
  status text not null default 'active' check (status in ('active','suspended','archived')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table tenants add column if not exists country_code char(2) not null default 'US';

create table if not exists universes (
  id text not null,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','suspended','archived')),
  settings jsonb not null default '{}'::jsonb,
  primary key (tenant_id, id)
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  password_hash text not null,
  first_name text,
  last_name text,
  role text not null default 'customer' check (role in ('customer','seller','support','admin','owner')),
  status text not null default 'active' check (status in ('active','invited','locked','deleted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_memberships (
  tenant_id text not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'customer',
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null,
  parent_id uuid references categories(id),
  slug text not null,
  name text not null,
  translations jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  status text not null default 'active',
  unique (tenant_id, universe_id, slug),
  foreign key (tenant_id, universe_id) references universes(tenant_id, id) on delete cascade
);

create table if not exists seller_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  display_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','suspended','rejected')),
  payout_provider text,
  payout_reference text,
  compliance jsonb not null default '{}'::jsonb,
  unique (tenant_id, user_id)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null,
  seller_id uuid references seller_profiles(id),
  category_id uuid references categories(id),
  sku text not null,
  slug text not null,
  title text not null,
  description text not null default '',
  media jsonb not null default '[]'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  price numeric(19,4) not null check (price >= 0),
  currency char(3) not null default 'USD',
  compare_at_price numeric(19,4),
  status text not null default 'active' check (status in ('draft','active','paused','archived')),
  rating numeric(3,2) not null default 0,
  review_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, universe_id, sku),
  unique (tenant_id, universe_id, slug),
  foreign key (tenant_id, universe_id) references universes(tenant_id, id) on delete cascade
);

create index if not exists products_search_idx on products using gin (to_tsvector('simple', title || ' ' || description));
create index if not exists products_tenant_category_idx on products (tenant_id, universe_id, category_id, status);

create table if not exists product_type_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  type_key text not null,
  display_name text not null,
  schema jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  fulfillment_modes jsonb not null default '[]'::jsonb,
  compliance jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  enabled boolean not null default true,
  unique (tenant_id, universe_id, type_key)
);

alter table products add column if not exists product_type_key text not null default 'physical';
alter table products add column if not exists brand text;
alter table products add column if not exists tax_code text;
alter table products add column if not exists fulfillment_config jsonb not null default '{}'::jsonb;
alter table products add column if not exists compliance_data jsonb not null default '{}'::jsonb;
alter table products add column if not exists seo jsonb not null default '{}'::jsonb;
create index if not exists products_type_idx on products (tenant_id, universe_id, product_type_key, status);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null,
  product_id uuid not null references products(id) on delete cascade,
  sku text not null,
  barcode text,
  title text,
  options jsonb not null default '{}'::jsonb,
  media jsonb not null default '[]'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  price numeric(19,4) not null check (price >= 0),
  currency char(3) not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, universe_id, sku)
);

create table if not exists product_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null,
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  seller_id uuid references seller_profiles(id),
  offer_key text not null,
  price numeric(19,4) not null check (price >= 0),
  currency char(3) not null,
  compare_at_price numeric(19,4),
  quantity_limit integer,
  condition text not null default 'new',
  fulfillment_mode text not null default 'platform',
  promise jsonb not null default '{}'::jsonb,
  promotions jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, universe_id, offer_key)
);
create index if not exists product_offers_buybox_idx on product_offers (tenant_id, universe_id, product_id, status, price);

create table if not exists product_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null,
  parent_product_id uuid not null references products(id) on delete cascade,
  child_product_id uuid not null references products(id),
  quantity numeric(19,6) not null check (quantity > 0),
  required boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  unique (parent_product_id, child_product_id)
);

create table if not exists digital_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  asset_type text not null,
  storage_ref text not null,
  access_policy jsonb not null default '{}'::jsonb,
  drm_config jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists service_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  provider_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  timezone text not null,
  location jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  unique (product_id, starts_at, ends_at)
);

create table if not exists product_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  interval_unit text not null,
  interval_count integer not null check (interval_count > 0),
  trial_days integer not null default 0,
  renewal_policy jsonb not null default '{}'::jsonb,
  cancellation_policy jsonb not null default '{}'::jsonb,
  status text not null default 'active'
);

create table if not exists product_compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  requirement_key text not null,
  jurisdiction text,
  rules jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  unique (tenant_id, product_id, requirement_key, jurisdiction)
);

create table if not exists inventory_items (
  tenant_id text not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  location_code text not null,
  available integer not null default 0 check (available >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  reorder_point integer not null default 0,
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, product_id, location_code)
);

create table if not exists carts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null,
  user_id uuid references users(id) on delete cascade,
  anonymous_token text,
  currency char(3) not null,
  status text not null default 'active' check (status in ('active','converted','abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, universe_id) references universes(tenant_id, id) on delete cascade
);

create unique index if not exists carts_user_active_idx on carts (tenant_id, universe_id, user_id) where status = 'active' and user_id is not null;
create table if not exists cart_items (
  cart_id uuid not null references carts(id) on delete cascade,
  product_id uuid not null references products(id),
  variant_id uuid references product_variants(id),
  offer_id uuid references product_offers(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(19,4) not null,
  added_at timestamptz not null default now(),
  primary key (cart_id, product_id)
);
alter table cart_items add column if not exists variant_id uuid references product_variants(id);
alter table cart_items add column if not exists offer_id uuid references product_offers(id);

create table if not exists idempotency_keys (
  tenant_id text not null references tenants(id) on delete cascade,
  user_id uuid,
  key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (tenant_id, user_id, key)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null,
  user_id uuid not null references users(id),
  order_number text not null,
  status text not null default 'pending_payment' check (status in ('pending_payment','paid','processing','shipped','delivered','cancelled','returned','refunded')),
  currency char(3) not null,
  subtotal numeric(19,4) not null,
  tax numeric(19,4) not null default 0,
  shipping numeric(19,4) not null default 0,
  total numeric(19,4) not null,
  shipping_address jsonb not null,
  billing_address jsonb,
  payment_status text not null default 'pending',
  payment_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_number),
  foreign key (tenant_id, universe_id) references universes(tenant_id, id) on delete cascade
);
create index if not exists orders_user_idx on orders (tenant_id, user_id, created_at desc);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  seller_id uuid references seller_profiles(id),
  sku text not null,
  title text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(19,4) not null,
  total numeric(19,4) not null,
  snapshot jsonb not null default '{}'::jsonb
);

create table if not exists payment_intents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  user_id uuid not null references users(id),
  provider_connector_id uuid,
  provider text not null,
  provider_intent_id text,
  amount numeric(19,4) not null check (amount >= 0),
  currency char(3) not null,
  status text not null default 'requires_payment_method' check (status in ('requires_payment_method','requires_action','processing','succeeded','failed','cancelled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_intents_order_idx on payment_intents (tenant_id, order_id);
alter table payment_intents add column if not exists provider_connector_id uuid;
alter table payment_intents add column if not exists provider_reference text;

alter table order_items add column if not exists variant_id uuid references product_variants(id);
alter table order_items add column if not exists offer_id uuid references product_offers(id);

create table if not exists exchange_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null,
  order_id uuid not null references orders(id) on delete cascade,
  return_request_id uuid,
  user_id uuid not null references users(id),
  request_type text not null,
  reason text not null,
  status text not null default 'requested',
  items jsonb not null default '[]'::jsonb,
  replacement_items jsonb not null default '[]'::jsonb,
  price_difference numeric(19,4) not null default 0,
  currency char(3) not null,
  policy_key text not null,
  resolution jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (request_type in ('exchange','replacement','trade_in'))
);
create index if not exists exchange_requests_user_idx on exchange_requests (tenant_id, universe_id, user_id, created_at desc);

create table if not exists refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null,
  order_id uuid not null references orders(id) on delete cascade,
  return_request_id uuid,
  payment_intent_id uuid references payment_intents(id),
  user_id uuid not null references users(id),
  amount numeric(19,4) not null check (amount > 0),
  currency char(3) not null,
  status text not null default 'requested',
  provider_reference text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists refunds_order_idx on refunds (tenant_id, universe_id, order_id, created_at desc);

create table if not exists payment_connectors (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  connector_key text not null,
  adapter_module text not null,
  enabled boolean not null default false,
  priority integer not null default 100,
  supported_currencies jsonb not null default '[]'::jsonb,
  supported_regions jsonb not null default '[]'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  secret_ref text,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, universe_id, connector_key)
);
create index if not exists payment_connectors_resolution_idx on payment_connectors (tenant_id, universe_id, enabled, priority);

create table if not exists service_connectors (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  service_type text not null,
  universe_id text,
  connector_key text not null,
  adapter_module text not null,
  enabled boolean not null default false,
  priority integer not null default 100,
  regions jsonb not null default '[]'::jsonb,
  country_codes jsonb not null default '[]'::jsonb,
  currencies jsonb not null default '[]'::jsonb,
  locales jsonb not null default '[]'::jsonb,
  channels jsonb not null default '[]'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  secret_ref text,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, service_type, universe_id, connector_key)
);
create index if not exists service_connectors_resolution_idx on service_connectors (tenant_id, service_type, universe_id, enabled, priority);
create table if not exists provider_secrets (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  service_type text not null,
  connector_key text not null,
  ciphertext text not null,
  version integer not null default 1,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, universe_id, service_type, connector_key)
);
create index if not exists provider_secrets_lookup_idx on provider_secrets (tenant_id, service_type, connector_key);
insert into service_connectors (tenant_id, service_type, universe_id, connector_key, adapter_module, enabled, priority, regions, currencies, capabilities, config, secret_ref, effective_from, effective_until)
select tenant_id, 'payment', universe_id, connector_key, adapter_module, enabled, priority, supported_regions, supported_currencies, capabilities, config, secret_ref, effective_from, effective_until from payment_connectors
on conflict (tenant_id, service_type, universe_id, connector_key) do nothing;

create table if not exists runtime_config (
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  namespace text not null,
  config_key text not null,
  value jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, universe_id, namespace, config_key)
);
create index if not exists runtime_config_lookup_idx on runtime_config (tenant_id, namespace, effective_from, effective_until);

create table if not exists entity_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  entity_key text not null,
  display_name text not null,
  schema jsonb not null default '{"type":"object","properties":{}}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  lifecycle jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  status text not null default 'active' check (status in ('draft','active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, universe_id, entity_key)
);

create table if not exists entity_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  entity_type_id uuid not null references entity_types(id) on delete restrict,
  external_key text,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  status text not null default 'active',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, universe_id, entity_type_id, external_key)
);
create index if not exists entity_records_lookup_idx on entity_records (tenant_id, universe_id, entity_type_id, status, updated_at desc);
create index if not exists entity_records_data_idx on entity_records using gin (data);

create table if not exists relationship_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  relationship_key text not null,
  source_entity_key text not null,
  target_entity_key text not null,
  cardinality text not null default 'many_to_many' check (cardinality in ('one_to_one','one_to_many','many_to_one','many_to_many')),
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (tenant_id, universe_id, relationship_key)
);

create table if not exists entity_relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  relationship_type_id uuid not null references relationship_types(id) on delete cascade,
  source_entity_id uuid not null references entity_records(id) on delete cascade,
  target_entity_id uuid not null references entity_records(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (relationship_type_id, source_entity_id, target_entity_id)
);
create index if not exists entity_relationships_source_idx on entity_relationships (tenant_id, universe_id, source_entity_id);
create index if not exists entity_relationships_target_idx on entity_relationships (tenant_id, universe_id, target_entity_id);

create table if not exists workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  workflow_key text not null,
  workflow_type text not null,
  task_queue text not null,
  trigger_events jsonb not null default '[]'::jsonb,
  signals jsonb not null default '[]'::jsonb,
  retry_policy jsonb not null default '{}'::jsonb,
  input_schema jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  version integer not null default 1,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, universe_id, workflow_key, version)
);
create index if not exists workflow_resolution_idx on workflow_definitions (tenant_id, universe_id, enabled, effective_from);

create table if not exists policy_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  policy_key text not null,
  policy_type text not null,
  definition jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  enabled boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  unique (tenant_id, universe_id, policy_key, version)
);

create table if not exists command_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  command_key text not null,
  entity_type_key text,
  operation text not null,
  initial_state text,
  workflow_key text,
  input_schema jsonb not null default '{}'::jsonb,
  allowed_roles jsonb not null default '[]'::jsonb,
  idempotent boolean not null default true,
  enabled boolean not null default true,
  version integer not null default 1,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  unique (tenant_id, universe_id, command_key, version)
);
alter table command_definitions add column if not exists initial_state text;

create table if not exists state_machine_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  state_machine_key text not null,
  initial_state text not null,
  states jsonb not null default '{}'::jsonb,
  transitions jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  enabled boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  unique (tenant_id, universe_id, state_machine_key, version)
);

create table if not exists command_executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  command_key text not null,
  command_version integer not null,
  actor_id uuid references users(id),
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'accepted' check (status in ('accepted','running','succeeded','failed')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, actor_id, idempotency_key)
);

create table if not exists configuration_entries (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('platform','tenant','universe','country','region','channel','user')),
  scope_key text not null,
  namespace text not null,
  config_key text not null,
  value jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_type, scope_key, namespace, config_key)
);
create index if not exists configuration_resolution_idx on configuration_entries (namespace, config_key, scope_type, scope_key, effective_from);

create table if not exists data_planes (
  id uuid primary key default gen_random_uuid(),
  plane_key text unique not null,
  adapter_module text not null default 'postgres',
  endpoint_secret_ref text,
  topology jsonb not null default '{}'::jsonb,
  capacity jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','draining','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_data_routes (
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  data_plane_id uuid not null references data_planes(id),
  shard_key text not null,
  weight integer not null default 100,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  primary key (tenant_id, universe_id, shard_key)
);
create index if not exists tenant_data_routes_lookup_idx on tenant_data_routes (tenant_id, universe_id, effective_from, effective_until);

create table if not exists module_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  module_key text not null,
  display_name text not null,
  labels jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  entities jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  units jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  version integer not null default 1,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, universe_id, module_key)
);
create index if not exists module_resolution_idx on module_definitions (tenant_id, universe_id, module_key, enabled, effective_from);

create table if not exists conversion_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  module_key text not null,
  from_unit text not null,
  to_unit text not null,
  rate numeric(38,18) not null check (rate > 0),
  rounding_mode text not null default 'half_up',
  decimal_places integer not null default 2,
  fee numeric(38,18) not null default 0,
  config jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, universe_id, module_key, from_unit, to_unit, effective_from)
);
create index if not exists conversion_resolution_idx on conversion_rules (tenant_id, universe_id, module_key, from_unit, to_unit, effective_from);

create table if not exists value_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  module_key text not null,
  owner_type text not null,
  owner_id text not null,
  unit text not null,
  display_name text,
  status text not null default 'active' check (status in ('active','frozen','closed')),
  available numeric(38,18) not null default 0 check (available >= 0),
  held numeric(38,18) not null default 0 check (held >= 0),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, universe_id, module_key, owner_type, owner_id, unit)
);

create table if not exists value_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  module_key text not null,
  account_id uuid not null references value_accounts(id),
  entry_type text not null,
  direction text not null check (direction in ('credit','debit')),
  amount numeric(38,18) not null check (amount > 0),
  unit text not null,
  balance_after numeric(38,18) not null,
  reference_type text,
  reference_id text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, module_key, account_id, idempotency_key, direction)
);
create index if not exists value_ledger_account_idx on value_ledger_entries (tenant_id, module_key, account_id, created_at desc);

create table if not exists capability_bundles (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  bundle_key text not null,
  version integer not null default 1,
  manifest jsonb not null,
  status text not null default 'active' check (status in ('draft','active','retired')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (tenant_id, universe_id, bundle_key, version)
);

create table if not exists platform_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  event_id text not null,
  event_type text not null,
  source text not null,
  subject text,
  time timestamptz not null default now(),
  data_content_type text not null default 'application/json',
  data jsonb not null default '{}'::jsonb,
  correlation_id text,
  causation_id text,
  metadata jsonb not null default '{}'::jsonb,
  unique (tenant_id, event_id)
);
create index if not exists platform_events_type_idx on platform_events (tenant_id, universe_id, event_type, time desc);

create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  label text not null default 'Address',
  recipient text not null,
  address jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists addresses_user_idx on addresses (tenant_id, user_id);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  order_id uuid references orders(id),
  rating integer not null check (rating between 1 and 5),
  title text,
  body text not null,
  status text not null default 'pending' check (status in ('pending','published','rejected')),
  created_at timestamptz not null default now(),
  unique (tenant_id, product_id, user_id)
);
create index if not exists reviews_product_idx on reviews (tenant_id, product_id, status, created_at desc);

create table if not exists return_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  order_id uuid not null references orders(id),
  user_id uuid not null references users(id),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','label_created','received','refunded','rejected')),
  items jsonb not null,
  resolution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  carrier text,
  tracking_number text,
  status text not null default 'pending' check (status in ('pending','label_created','in_transit','out_for_delivery','delivered','exception')),
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  token_hash text unique not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists outbox_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','published','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists outbox_pending_idx on outbox_events (status, available_at);

create table if not exists feature_flags (
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text,
  key text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  primary key (tenant_id, universe_id, key)
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  actor_id uuid,
  action text not null,
  resource_type text not null,
  resource_id text,
  ip inet,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Portal-defined resources. The schema is portable JSON metadata; adapters may
-- materialize it as columns, documents, keys, vertices, or search records.
create table if not exists resource_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null default 'default',
  resource_key text not null,
  display_name text not null,
  storage_model text not null default 'relational',
  schema jsonb not null default '{"columns":[]}'::jsonb,
  options jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('draft','active','archived')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, universe_id, resource_key)
);

create table if not exists resource_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null default 'default',
  resource_key text not null,
  external_key text,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','deleted')),
  version bigint not null default 1,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, universe_id, resource_key) references resource_definitions(tenant_id, universe_id, resource_key) on delete cascade
);
create index if not exists resource_records_scope_idx on resource_records (tenant_id, universe_id, resource_key, status, updated_at desc);

create table if not exists resource_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  universe_id text not null default 'default',
  link_type text not null,
  from_resource_key text not null,
  from_id uuid not null,
  to_resource_key text not null,
  to_id uuid not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, universe_id, link_type, from_id, to_id)
);
create index if not exists resource_links_from_idx on resource_links (tenant_id, universe_id, from_id, link_type);

create or replace function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
do $$ declare table_name text; begin foreach table_name in array array['tenants','products','carts','orders','payment_intents','payment_connectors','service_connectors','provider_secrets','runtime_config','entity_types','entity_records','workflow_definitions','module_definitions','value_accounts','data_planes','return_requests','exchange_requests','refunds','shipments','command_executions','resource_definitions','resource_records'] loop execute format('drop trigger if exists %I_updated_at on %I', table_name, table_name); execute format('create trigger %I_updated_at before update on %I for each row execute function set_updated_at()', table_name, table_name); end loop; end $$;
