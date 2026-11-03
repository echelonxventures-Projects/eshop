export const repositoryContract = Object.freeze({
  identity: ['findUserByEmail','createUser','addMembership','findRefreshToken','storeRefreshToken','revokeRefreshToken'],
  context: ['resolveTenantContext'],
  configuration: ['resolveConfiguration','readRuntimeConfig','writeRuntimeConfig'],
  registry: ['resolveEntityType','resolveRelationshipType','resolveWorkflow','resolvePolicy','resolveCommand','resolveStateMachine','listEntityTypes'],
  catalog: ['listCategories','listProducts','getProduct','createProduct','updateProduct'],
  commerce: ['getCart','upsertCartItem','updateCartItem','createOrder','listOrders'],
  events: ['publishEvent','claimOutbox','markOutboxPublished','markOutboxFailed']
});

export function assertRepositories(repositories) {
  for (const [area, methods] of Object.entries(repositoryContract)) {
    if (typeof repositories?.[area] !== 'object') throw new Error(`Storage adapter is missing repository area: ${area}`);
    for (const method of methods) if (typeof repositories[area][method] !== 'function') throw new Error(`Storage adapter is missing repository operation: ${area}.${method}`);
  }
  return repositories;
}
