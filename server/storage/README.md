# Storage boundary

Only files under `server/storage/` may import a database client or use a vendor query language. Domain services use semantic repositories and the resource contract. The legacy SQL facade remains for the existing commerce schema and is available only to adapters that explicitly implement it.

An adapter must own:

- durable resource operations and serialization;
- transactions and concurrency guarantees;
- schema/index migration or equivalent provisioning;
- health/readiness checks;
- outbox durability and claim semantics;
- decimal, timestamp, JSON, and identifier mapping;
- backup, restore, and topology behavior for its deployment.

## All storage models

Adapters may be relational, document, graph, key-value, search-oriented, vector, or distributed. They must declare a capability profile. Core platform operations use semantic repositories and portable guarantees. Operations requiring joins, exact ledgers, atomic multi-record transactions, full text, vector search, geo search, TTL, or change streams must call capability negotiation and return `storage_capability_unavailable` when the selected adapter cannot provide that guarantee.

An adapter must never claim a capability by emulation that weakens the guarantee. For example, a document store must not report relational transactions unless it can provide the required atomicity; a key-value store must not report joins unless it exposes an equivalent consistent read model.

Adapters must expose capability metadata so a capability can fail clearly when its consistency, indexing, or transaction requirements are unavailable.
