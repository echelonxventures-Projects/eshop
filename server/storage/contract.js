export const storageAdapterContract = Object.freeze({
  required: ['repositories', 'resources', 'withTransaction', 'health', 'migrate', 'close'],
  capabilities: ['transactions', 'optimisticConcurrency', 'json', 'decimal', 'fullText', 'joins', 'outbox', 'conditionalWrites', 'timeOrdering', 'relationships', 'vectorSearch', 'geoSearch', 'ttl', 'changeStreams'],
  boundary: 'domain-services-must-not-import-vendor-clients'
});

export function assertStorageAdapter(adapter) {
  for (const method of storageAdapterContract.required.filter(method => !['repositories', 'resources'].includes(method))) if (typeof adapter?.[method] !== 'function') throw new Error(`Storage adapter must implement ${method}()`);
  if (!adapter?.repositories || typeof adapter.repositories !== 'object') throw new Error('Storage adapter must expose repositories');
  if (!adapter?.resources || typeof adapter.resources !== 'object') throw new Error('Storage adapter must expose resources');
  if (!adapter?.capabilities || typeof adapter.capabilities !== 'object') throw new Error('Storage adapter must declare capabilities');
  return adapter;
}
