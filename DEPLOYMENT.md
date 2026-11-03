# Production deployment

## Runtime contract

The API requires a configured storage adapter and, for durable workflow dispatch, Temporal. The API serves the built storefront from `dist/` when `NODE_ENV=production`. PostgreSQL is the reference storage adapter; another adapter may be supplied through `STORAGE_ADAPTER_MODULE`. Production must not rely on the test adapters seeded for local development.

The default API port is `8899`, and the Admin Portal is available at `/admin` on that same service.

Required production environment:

```bash
NODE_ENV=production
STORAGE_ADAPTER=postgres
DATABASE_URL=postgres://... # required by the PostgreSQL adapter
DATABASE_SSL=true # adapter-specific
# document, keyvalue, graph, search, and vector adapters use STORAGE_FILE_PATH instead.
JWT_SECRET=<random secret of at least 32 characters>
CORS_ORIGIN=https://store.example.com
```

Optional runtime settings are documented in `.env.example`.

The platform exposes Prometheus-compatible metrics at `/api/metrics`; set `METRICS_TOKEN` to protect the endpoint. Requests are rate-limited by client address using `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX`. Provider webhooks are accepted at `/api/webhooks/:serviceType/:connectorKey`, require HMAC signatures by default, and are deduplicated by event ID before entering the durable event/outbox pipeline.

Catalog search is available at `/api/catalog/search?q=...` and uses a portal-configured search connector when available, with the PostgreSQL full-text/local catalog fallback otherwise. Recommendations use the same pattern at `/api/recommendations`. Authenticated clients can publish product and business telemetry through `/api/analytics/events`; these events are persisted and dispatched through the platform event/outbox pipeline.

## Build and migrate

```bash
npm ci
npm run build
npm run db:migrate
npm start
```

Run `npm run db:seed` only for a new non-production environment. Production tenants, modules, product types, policies, connectors, and experience configuration must be registered through controlled migration or admin capability-bundle operations.

## Container deployment

```bash
docker build -t marketly-platform:latest .
docker run --env-file .env -p 8899:8899 marketly-platform:latest
```

Run migrations as a release job using the same image before switching application traffic:

```bash
docker run --rm --env-file .env marketly-platform:latest npm run db:migrate
```

Run the outbox worker as a separate horizontally scalable process only after `TEMPORAL_ADDRESS` and registered workflow workers are available:

```bash
docker run --rm --env-file .env marketly-platform:latest npm run worker:outbox
```

## Provider onboarding from Admin Portal

1. Migrate the database and start the API.
2. Open `http://localhost:8899/admin`.
3. Sign in with a tenant admin or owner account.
4. Choose a service type, enter the provider base URL, API key, supported context, and operation mapping JSON.
5. Save and activate the provider, then use **Test saved provider**.

The API key is encrypted with `PROVIDER_ENCRYPTION_KEY` before it is stored in `provider_secrets`. The key is never returned to the portal or included in connector configuration responses. Runtime requests select the active connector by context and execute the configured adapter operation.

## Health checks

- `GET /api/live` checks process liveness without touching dependencies.
- `GET /api/ready` checks the configured storage adapter readiness.
- `GET /api/health` checks the configured storage adapter and returns service metadata.

Traffic should be sent only to instances passing `/api/ready`. Shutdown uses connection draining before closing the storage adapter.

## Portal-defined resources

Administrators use `/admin/` to create portable resources with arbitrary typed columns. The API exposes the resource lifecycle under `/api/admin/storage/resources`; adapters materialize those definitions as relational records, documents, key/value entries, graph vertices, or indexed records according to their model. Resource data is validated against the saved schema and uses optimistic versioning.

## Release gates

```bash
npm run check:server
npm run test:kernel
npm run build
npm run test:e2e
```

The E2E suite must run against a migrated, seeded disposable database in CI. Production deploys must also validate backups, restore procedures, secret rotation, connector health, outbox lag, database pool saturation, error rate, latency, and tenant-isolation probes.
