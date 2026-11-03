import {createJsonStorageAdapter} from './json-adapter.js';

export function createStorageAdapter(config) {
  return createJsonStorageAdapter(config, {model:'graph', fileName:'graph-storage.json', capabilities:{json:true, optimisticConcurrency:true, conditionalWrites:true, timeOrdering:true, relationships:true}});
}
