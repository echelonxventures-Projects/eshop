# Commerce workflow contracts

The storefront is configured around durable workflow contracts instead of embedding order and inventory state in the browser. `platform-config.json` is the portable capability manifest; production adapters should implement the listed workflows with Temporal workers.

## Required workflows

- `OrderLifecycleWorkflow`: authorize payment, reserve inventory, create fulfillment, track shipment, handle cancellation and returns.
- `InventoryReservationWorkflow`: reserve, release, reconcile, and expire stock reservations with idempotent activities.
- `SellerOnboardingWorkflow`: verify business identity, payout account, tax documents, and marketplace permissions.
- `SubscriptionRenewalWorkflow`: renew, retry failed billing, pause, resume, and cancel recurring plans.

Each workflow should use the configured task queue and signal names, persist tenant and universe IDs in workflow input, and treat currency and locale as order-time immutable values. This keeps long-running commerce operations safe across retries, deployments, and regional failures.
