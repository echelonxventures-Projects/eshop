# Marketly platform foundation

The non-negotiable engineering rules for this architecture live in `PLATFORM_CONSTITUTION.md`.

Marketly is being shaped as a configuration-driven, multi-tenant commerce platform. The browser is a presentation client; money, identity, inventory, order state, and permissions must be owned by backend services.

## Configuration model

Configuration resolves in this order:

`platform → tenant → universe → region → channel → user`

Every resolved request carries `tenant_id`, `universe_id`, `region`, `locale`, `currency`, and `channel`. Feature flags, catalog visibility, tax rules, payment methods, delivery promises, seller policies, translations, and pricing rules are configuration records with effective dates and audit history—not UI constants.

The first portable manifest lives in `platform-config.json`. It can be replaced by a configuration service without changing storefront components.

## Scalable data foundation

- Pluggable durable storage provider for tenants, identities, catalog, pricing, carts, orders, payments, fulfillment, sellers, reviews, and configuration. PostgreSQL is the current reference adapter.
- Every tenant-owned table carries `tenant_id`; high-volume tables are partitioned by tenant and time where appropriate.
- Read replicas and search indexes serve catalog discovery; object storage holds media and documents.
- Redis-compatible caching is for sessions, rate limits, carts, and short-lived projections—not the source of truth.
- Transactional outbox plus idempotency keys protect payment, inventory, and fulfillment boundaries.
- `data_planes` and `tenant_data_routes` provide a registry for moving tenants/universes between storage clusters, regions, or future storage adapters without changing domain APIs.
- Row-level security, encrypted secrets, audit events, soft deletion, and retention policies are mandatory platform concerns.

## Commerce capabilities

The service boundaries cover identity and access, tenant administration, catalog/PIM, search, pricing/promotions/tax, cart/checkout, payment adapters, inventory, fulfillment, delivery promises, orders, returns/refunds, subscriptions, reviews, recommendations, customer support, notifications, seller onboarding and payouts, business procurement, advertising, analytics, localization, and fraud/risk.

## Durable operations

Long-running operations use Temporal workflows described in `temporal-workflows.md`. Workflow inputs must include tenant and universe context, immutable order-time currency/locale, and an idempotency key. Activities should call bounded service APIs; no workflow should reach the browser or a database directly.

## Configuration-first boundary

Provider and business-rule selection is configuration data, not route code. Generic connector records select adapter modules by service type, tenant, universe, country, region, channel, locale, currency, capabilities, effective dates, and priority. The same registry handles payments, logistics, tax, search, fraud, notifications, identity, pricing, fulfillment, and future service types without a schema change. Runtime configuration overrides live in the database with audit events and can be changed through admin APIs. The platform deliberately does not choose a payment or logistics vendor or silently fall back to a fake one: if no connector is configured, the operation returns a clear `connector_unavailable` response.

Entities and relationships use the same model. `entity_types` stores JSON schemas and lifecycle capabilities; `entity_records` stores tenant-scoped data with optimistic versioning; `relationship_types` defines allowed graph edges; and `entity_relationships` stores the edges. `workflow_definitions` maps events to Temporal workflow types and queues, while `policy_definitions` stores versioned policy documents. This lets new domain objects and lifecycles be registered and validated without adding a new table or route for every object.

The current workspace contains the responsive storefront, local cart/wishlist behavior, a storage-adapter-backed commerce API, and the portable context manifest. PostgreSQL is currently the reference adapter; production deployments may provide another adapter implementing the storage contract.

## Scaling boundary

The kernel is horizontally stateless: request context, connector selection, entity registries, configuration inheritance, and workflow routing are database-backed. The topology registry records the data-plane assignment and shard key for each tenant/universe. A production deployment can bind `data_planes.adapter_module` to a database router or service mesh adapter, drain a plane, and move traffic by updating registry rows rather than changing domain code. Partitioning, replicas, queues, object storage, and external search remain deployment choices exposed through the same registry pattern.

## Future capability contract

Adding a future capability is a runtime registration operation, not a kernel rewrite. Register its module identity and white-label experience, entity JSON schemas, graph relationships, idempotent commands, state machines, policies, Temporal workflows, provider connectors, and topology routes. HTTP/JSON providers use the generic adapter; custom protocols use an installed adapter package implementing the connector contract. The platform kernel remains stable while the registry data changes.
