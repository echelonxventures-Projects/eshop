import {createJsonStorageAdapter} from './json-adapter.js';

export function createStorageAdapter(config) {
  return createJsonStorageAdapter(config, {model:'keyvalue', fileName:'keyvalue-storage.json', capabilities:{json:true, optimisticConcurrency:true, conditionalWrites:true, ttl:true, timeOrdering:true}});
}
