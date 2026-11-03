import {HttpError} from '../http.js';

export const storageCapabilities = Object.freeze({
  transactions: 'transactional atomicity across a bounded aggregate',
  optimisticConcurrency: 'version-checked updates',
  json: 'structured JSON/document values',
  decimal: 'exact decimal money and ledger arithmetic',
  fullText: 'search-index or native full-text queries',
  joins: 'cross-resource consistency reads',
  outbox: 'durable event publication records and claims',
  conditionalWrites: 'compare-and-set or equivalent atomic writes',
  timeOrdering: 'stable server-side ordering and effective dates',
  relationships: 'typed graph relationships',
  vectorSearch: 'semantic/vector similarity search',
  geoSearch: 'geospatial predicates and distance ordering',
  ttl: 'expiration and retention semantics',
  changeStreams: 'durable change notifications'
});

export function requireStorageCapability(adapter, capability, operation = 'operation') {
  if (adapter?.capabilities?.[capability] === true) return;
  throw new HttpError(501, `Storage capability is unavailable for ${operation}: ${capability}`, 'storage_capability_unavailable', {capability,operation});
}

export function normalizeCapabilities(value = {}) {
  return Object.fromEntries(Object.keys(storageCapabilities).map(key => [key, value[key] === true]));
}
