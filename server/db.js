import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {config} from './config.js';
import {assertStorageAdapter} from './storage/contract.js';
import {assertRepositories} from './storage/repositories.js';

const builtin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'storage', `${config.storageAdapter}.js`);
const modulePath = config.storageAdapterModule || pathToFileURL(builtin).href;
const adapterModule = await import(modulePath);
export const storage = assertStorageAdapter(await adapterModule.createStorageAdapter(config));
export const repositories = assertRepositories(storage.repositories);
export const resources = storage.resources;
export const capabilities = storage.capabilities;
export const query = storage.query;
export const withTransaction = storage.withTransaction;
export const withTenant = (tenantId, callback) => storage.withTransaction(callback, {tenantId});
export const health = storage.health;
export const migrate = storage.migrate;
export const closeDb = storage.close;
