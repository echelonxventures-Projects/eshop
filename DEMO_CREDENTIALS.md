# Local demo credentials

These accounts are created or reset by `npm run db:seed`. They are for local/demo environments only and must never be used in production.

All accounts use:

```text
Password: Marketly-Demo-2026!
Tenant:   United States (us)
Universe: Personal shopping (consumer)
Locale:   en-US
Currency: USD
API:      http://localhost:8899
Admin:    http://localhost:8899/admin/
```

| Role | Email | Main use |
| --- | --- | --- |
| Customer | `customer.demo@marketly.local` | Browse, cart, checkout, orders, reviews, support, subscriptions |
| Seller | `seller.demo@marketly.local` | Seller catalog, variants, offers, inventory, onboarding |
| Support | `support.demo@marketly.local` | Support-case workflows and support operations |
| Admin | `admin.demo@marketly.local` | Providers, runtime configuration, feature flags, registry |
| Owner | `owner.demo@marketly.local` | Full tenant administration and platform configuration |

## Create the accounts

```bash
npm run db:migrate
npm run db:seed
```

The seed creates the seller profile in approved state and registers local test payment, tax, logistics, and fulfillment connectors. Production deployments must not run this seed or use these accounts.
