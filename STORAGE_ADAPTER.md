# Storage adapter contract

The platform does not require PostgreSQL, a particular database engine, or a particular application language. The current repository includes PostgreSQL as its first reference adapter because the existing relational schema and local development environment use it.

Set the adapter at runtime:

```bash
STORAGE_ADAPTER=postgres
```

Built-in storage models are selected without code changes:

```bash
STORAGE_ADAPTER=postgres   # relational reference adapter
STORAGE_ADAPTER=document   # durable JSON documents
STORAGE_ADAPTER=keyvalue   # durable key/value records
STORAGE_ADAPTER=graph      # durable vertices and links
STORAGE_ADAPTER=search     # indexed/search-oriented records
STORAGE_ADAPTER=vector     # vector/search-oriented records
```

Or load an installed/workspace adapter:

```bash
STORAGE_ADAPTER_MODULE=@marketly/storage-adapter-example
```

An adapter exports `createStorageAdapter(config)` and returns:

```js
{
  query(text, params),
  withTransaction(callback, context),
  health(),
  migrate(schemaOrManifest),
  close()
}
```

The adapter owns connection pooling, transactions, migrations, indexes, serialization, optimistic concurrency, decimal handling, durable outbox persistence, resource definitions, and health checks. Domain modules import the facade from `server/db.js`; they must not import `pg`, a database SDK, or a vendor-specific connection object.

## Portal-defined resources

Administrators can create a resource from **Admin → Storage and custom tables**. A resource has a key, display name, storage model, and any number of typed columns. The same resource API is mapped by each adapter to its native model: relational JSON records, documents, key/value entries, graph vertices, or indexed records. Records support validation, pagination, optimistic version checks, soft deletion, and graph links.

This avoids unsafe runtime DDL while still allowing every table shape and column set to be added at runtime. A deployment that needs physical native tables or indexes can provide an adapter module that materializes the same resource contract.

The remaining migration boundary is the domain query language: the current reference implementation still contains relational SQL and therefore requires a compatible relational adapter. Full document, graph, or key-value implementations require the domain repositories to be completed behind this contract rather than translating arbitrary SQL. That work is a platform migration, not a change to the public API contract.
