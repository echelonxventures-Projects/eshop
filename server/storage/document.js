import {createJsonStorageAdapter} from './json-adapter.js';

export function createStorageAdapter(config) {
  return createJsonStorageAdapter(config, {model:'document', fileName:'document-storage.json', capabilities:{json:true, optimisticConcurrency:true, conditionalWrites:true, timeOrdering:true, ttl:true}});
}
