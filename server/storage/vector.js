import {createJsonStorageAdapter} from './json-adapter.js';

export function createStorageAdapter(config) {
  return createJsonStorageAdapter(config, {model:'vector', fileName:'vector-storage.json', capabilities:{json:true, optimisticConcurrency:true, conditionalWrites:true, timeOrdering:true, vectorSearch:true, fullText:true}});
}
