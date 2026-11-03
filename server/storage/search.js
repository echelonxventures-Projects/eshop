import {createJsonStorageAdapter} from './json-adapter.js';

export function createStorageAdapter(config) {
  return createJsonStorageAdapter(config, {model:'search', fileName:'search-storage.json', capabilities:{json:true, optimisticConcurrency:true, conditionalWrites:true, timeOrdering:true, fullText:true, geoSearch:true}});
}
