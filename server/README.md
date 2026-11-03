# Marketly API

The platform rules and completion gates are defined in [`../PLATFORM_CONSTITUTION.md`](../PLATFORM_CONSTITUTION.md). API work must preserve tenant isolation, configuration-first provider selection, idempotency, versioned contracts, and transactional outbox behavior.

The API is a tenant-aware service backed by the configured storage adapter. PostgreSQL is the current reference adapter; domain behavior uses the storage boundary rather than requiring a database vendor. It keeps business state out of the browser and uses explicit request context headers:

- `x-tenant-id` — `us`, `gb`, or `in`
- `x-universe-id` — `consumer` or `business`
- `x-locale` — locale used for presentation and downstream pricing/tax rules
- `x-currency` — requested display/order currency

## Run locally

1. Copy `.env.example` to `.env` and set a real PostgreSQL connection string and JWT secret.
2. Run `npm run db:migrate`.
3. Run `npm run db:seed`.
4. Run `npm run server`.

For local role-based testing, see [`../DEMO_CREDENTIALS.md`](../DEMO_CREDENTIALS.md). The demo seed is explicitly blocked when `NODE_ENV=production`.

The API listens on `http://localhost:8899` by default. `GET /api/config` and `GET /api/health` are available without a database context; all commerce routes require a valid tenant/universe and authenticated routes require `Authorization: Bearer <access-token>`.

## Full checkout verification

With PostgreSQL available, run:

```bash
npm run db:migrate
npm run db:seed
npm run test:kernel
npm run test:e2e
```

`test:e2e` exercises registration, white-label experience resolution, catalog retrieval, authenticated cart creation, transactional order creation, registry-selected test payment intent creation, payment confirmation, and paid order history. The test payment connector is seeded only for the local `us/consumer` context; production contexts remain unconfigured until a real connector is registered.

## API surfaces

- `/api/auth/*` — registration, login, refresh-token rotation
- `/api/catalog/*` — tenant/universe-scoped categories and products
- `/api/cart/*` — authenticated carts and quantity updates
- `/api/orders/*` — idempotent checkout, order history, cancellation
- `/api/seller/*` — seller/admin catalog access
- `/api/admin/*` — audited feature flags, runtime settings, and connector registry
- `/api/services/:serviceType/:operation` — dynamically selected connector operation for any registered service type
- `/api/registry/*` and `/api/entities/*` — registered entity types, records, and relationships
- `/api/modules/:moduleKey/*` — configured vertical-module metadata, conversions, accounts, and ledger entries
- `/api/events` — CloudEvents-compatible event publication with transactional outbox delivery
- `/api/admin/capability-bundles` — atomic runtime registration of a complete future capability

Order creation locks inventory rows, writes an order and an outbox event in one transaction, and requires an `Idempotency-Key`. A worker can publish `outbox_events` to the Temporal workflows in `temporal-workflows.md`.

## Configuration and extension points

Provider selection is not compiled into the payment route. Payment connectors are database records scoped to a tenant/universe, ordered by priority, filtered by currency and region, and linked to an adapter module through the `PaymentConnector` contract. Configure them through `PUT /api/admin/payment-connectors/:key`:

```json
{
  "adapterModule": "payment/acquirer-adapter.js",
  "enabled": true,
  "priority": 10,
  "supportedCurrencies": ["USD", "EUR"],
  "supportedRegions": ["NA", "EU"],
  "capabilities": {"refunds": true, "3ds": true},
  "config": {"merchantAccount": "configured-value"},
  "secretRef": "ACQUIRER_API_KEY"
}
```

`adapterModule` can point to a local module below `ADAPTER_ROOT` or an installed package. The secret value is read from the process secret store by reference and never persisted in database configuration. The same extension pattern is represented for tax, shipping, search, and recommendation providers in `platform-config.json`.

Runtime business rules are stored in `runtime_config` and managed through `/api/admin/runtime-config/:namespace/:key`. Password policy, cart limits, shipping thresholds, fees, and idempotency windows can therefore be overridden per tenant/universe without changing application code.

The effective configuration API is `/api/configuration/:namespace/:key`. It resolves the manifest and database registry through `platform → tenant → universe → country → region → channel → user`; request handlers do not select a business default from environment variables.

The generic connector registry uses the same contract for every service type. A country-specific logistics connector, a universe-specific payment connector, or a platform-wide tax connector is just another `service_connectors` row with a different `service_type`, scope arrays, priority, and adapter module. Add new service types without changing the registry schema or resolver.

Entity types, relationship types, workflows, and policies are also registered in PostgreSQL. Entity payloads are validated against the registered JSON schema and use optimistic versioning. Relationships are constrained to their registered source and target entity types. Outbox dispatch resolves its Temporal workflow from `workflow_definitions`; there is no workflow-name switch statement in the worker.

Topology is registry-driven as well. `data_planes` describes a storage or infrastructure plane and `tenant_data_routes` assigns a tenant/universe/shard key to it. The request context exposes the selected topology so a deployment-specific database router, replica reader, or event-stream adapter can bind to it without changing domain handlers.

## Configurable vertical modules

`module_definitions` contains the client-facing name, labels, capabilities, entities, units, and module configuration. The same engine can expose a wallet as `Coin` for one tenant and `Star` for another. `conversion_rules` contains effective-dated rates, fees, precision, and rounding policy; the conversion API never embeds a rate. `value_accounts` and `value_ledger_entries` provide an immutable, idempotent account/ledger engine for wallet-like modules.

The manifest registers `wallet`, `fresh`, `bazaar`, `travel`, `pharmacy`, and `products_services` as configurable module definitions. Their domain-specific operations must be enabled through registered entities, commands, policies, workflows, and service connectors rather than added as hard-coded vendor or tenant branches.

## Add a future provider without rebuilding

For providers exposing HTTP/JSON, register a `service_connectors` row with `adapterModule: "http-json.js"` and configure its operations, endpoint, request templates, response mapping, scopes, capabilities, and secret reference. The generic `/api/services/:serviceType/:operation` route resolves and executes it at runtime. A new module follows the same runtime registration sequence: module definition → entity schemas → relationships → commands → state machines → policies → workflow definitions → connectors → experience configuration.

No application rebuild is required for those registrations. Providers with a custom protocol can be installed as an adapter package or module without changing the platform kernel; the package implements the stable connector contract.

Capability bundles make this atomic. A bundle can register the module, entity schemas, relationships, commands, state machines, workflow definitions, connectors, and experience configuration in one transaction. If any registration fails, the transaction rolls back; partial platform capabilities are not activated.
