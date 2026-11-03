# Connector adapter contract

An adapter is a module selected from the `service_connectors` registry. It exports operation functions whose names are configured under `capabilities.operations`.

```js
export async function getQuotes({connector, context, payload}) {
  // Read connector.config and connector.secret; call the external service.
  return {quotes: []};
}

export async function createIntent({connector, context, payload}) {
  return {status: 'requires_payment_method', providerIntentId: 'external-id'};
}
```

Adapters must be idempotent for repeated operation keys, keep external credentials in `connector.secret`, and return serializable data. The platform owns tenant context, connector selection, audit boundaries, retries, and persistence; adapters own the external protocol.
