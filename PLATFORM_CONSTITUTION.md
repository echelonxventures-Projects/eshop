# Marketly Platform Constitution

This constitution defines the rules that every platform capability must obey. It is the contract between the storefront, backend, storage providers, external providers, workflows, and future modules.

## 1. Platform identity

Marketly is a configuration-driven, multi-tenant platform kernel. Commerce is the first capability, not the boundary of the platform. New industries, product types, providers, workflows, and user experiences must be addable through registered contracts wherever possible.

The platform promises extensibility and horizontal scalability through stable contracts. It does not promise infinite physical resources: every deployment remains bounded by its storage, compute, network, provider, and operational limits.

## 2. Non-negotiable invariants

1. **Tenant isolation** — Every tenant-owned read and write is scoped by tenant and universe. An access token is valid only for the context that issued it.
2. **Server authority** — Identity, authorization, money, inventory, order state, provider selection, and audit history are backend-owned. The browser is an untrusted presentation client.
3. **Configuration before branching** — Provider choice, product behavior, policy, workflow, pricing, fulfillment, translations, feature flags, and experience are resolved from registered configuration. Vendor or tenant names must not appear in business routing branches.
4. **Atomic business state** — Inventory, orders, payment state, idempotency records, and their domain events change transactionally at their consistency boundary.
5. **Idempotent external effects** — Every retryable command, payment operation, provider call, and event publication has an idempotency or deduplication strategy.
6. **Versioned contracts** — Schemas, commands, state machines, workflows, connectors, and modules are versioned or effective-dated. Existing records remain interpretable after a configuration change.
7. **Explicit failure** — Missing providers, invalid configuration, unsupported operations, policy violations, and stale versions return typed errors. The kernel never silently chooses a fake production provider.
8. **Auditability** — Administrative configuration, connector, policy, module, and lifecycle changes record the actor, resource, context, version, and time.
9. **Least privilege** — Customer, seller, support, admin, and owner capabilities are separately authorized. Entity reads and writes are owner- or role-scoped.
10. **Observable operations** — Requests have correlation IDs; durable events use CloudEvents-compatible envelopes; long-running work is dispatched through the outbox and registered workflows.

## 3. Stable extension contracts

### Product and service contract

Products are records with a registered `product_type_key`. A product type defines:

- JSON-schema-like attributes and required fields
- capabilities such as inventory, booking, recurring billing, compliance, or digital delivery
- allowed fulfillment modes
- compliance requirements
- lifecycle and workflow references

Variants, offers, bundles, digital assets, service slots, subscriptions, rentals, regulated items, and marketplace listings extend the product record through registered entities and related tables. The kernel validates the registered contract at create and update boundaries.

### Provider contract

Payments, tax, logistics, fulfillment, search, recommendations, identity, notifications, fraud, media, analytics, support, pricing, translation, and returns are service connector types. A connector is selected by tenant, universe, region, country, locale, currency, channel, capability, effective date, and priority.

Adapters implement operations declared by the connector. Adapter secrets are referenced by name and never stored as plaintext configuration.

### Entity, command, and lifecycle contract

Future business objects use registered entity types, relationships, commands, policies, and state machines. Commands require idempotency keys, validate registered input schemas, enforce roles, and record execution state. State changes must use the registered machine rather than route-local status strings.

### Workflow and event contract

Durable operations are registered workflow definitions. Domain events are persisted before dispatch through the transactional outbox. Workers resolve workflow definitions at runtime; they do not contain a vendor or capability switch statement.

## 4. Configuration hierarchy

Effective configuration resolves in this order:

`platform → tenant → universe → country → region → channel → user`

Configuration is immutable by default. Changes create a new version or effective-dated entry and are audited. Runtime configuration may override manifest defaults only through authorized administration APIs.

## 5. Storage and consistency rules

- The configured storage provider is the source of truth for durable business state. PostgreSQL is one reference adapter, not a platform requirement.
- Storage adapters implement the platform storage contract: parameterized execution, transactions, health, migration, close, optimistic concurrency, decimal-safe money, JSON data, and durable outbox support.
- Domain services depend on the storage contract and repository interfaces. A storage engine, client library, language runtime, or deployment tool must not appear in domain rules.
- Every tenant-owned table carries tenant scope directly or through a constrained parent.
- Transactions lock inventory and aggregate rows before deriving irreversible state.
- Money uses fixed-precision database numerics and immutable order-time currency, tax, shipping, and pricing snapshots.
- Read models, caches, search indexes, queues, and object storage are projections or providers, never the source of truth.
- Schema changes are additive, backward-compatible migrations whenever possible.
- High-volume tables must have tenant/time access paths and a documented partitioning strategy before production scale.

## 6. Security baseline

- Production requires an explicit database URL and JWT secret.
- Passwords are hashed; refresh tokens are stored only as hashes and rotated on use.
- Context-bound access tokens cannot cross tenants or universes.
- Secrets are resolved from the process secret store by reference.
- JSON input is bounded, validated, and never interpolated into SQL.
- Administrative writes require role authorization and audit records.
- Sensitive data must be minimized in logs, events, snapshots, and provider payloads.
- Rate limits, abuse detection, key rotation, backups, disaster recovery, and dependency patching are deployment gates.

## 7. Scalability boundary

The application kernel is stateless and horizontally replicable. Topology routes may assign tenant/universe/shard traffic to different data planes. Scaling a deployment means adding read replicas, search projections, queues, object storage, workers, and data planes behind the registered contracts—not rewriting domain handlers.

Every new capability must document:

1. its data ownership and consistency boundary;
2. its read model and indexing strategy;
3. its idempotency and retry behavior;
4. its event and workflow lifecycle;
5. its authorization and audit rules;
6. its tenant migration and rollback plan.

## 8. Definition of done for a capability

A capability is complete only when it has:

- registered configuration and versioned schema;
- backend create/read/update/lifecycle behavior;
- authorization and tenant isolation;
- provider contracts without vendor coupling;
- transactional and idempotency behavior;
- user and administrative flows where applicable;
- meaningful kernel and end-to-end tests;
- operational documentation and failure states.

Visible UI, a database table, or a route by itself is not completion.

## 9. Verification gates

Every change must pass the narrowest relevant checks and then the platform checks:

```bash
npm run check:server
npm run test:kernel
npm run build
npm run test:e2e
```

The E2E suite requires the configured storage adapter, its migration, and seed data. A blocked environment must be reported as blocked; it must never be reported as passing.
