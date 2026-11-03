import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assertCommandInput, assertTransition} from './registry.js';
import {manifestConfiguration} from './configuration.js';
import {validateProductType} from './catalog.js';
import {decryptSecret, encryptSecret} from './secrets.js';
import {normalizeCapabilities} from './storage/capabilities.js';
import {createStorageAdapter as createDocumentAdapter} from './storage/document.js';
import {createStorageAdapter as createKeyValueAdapter} from './storage/keyvalue.js';
import {createStorageAdapter as createGraphAdapter} from './storage/graph.js';
import {createStorageAdapter as createSearchAdapter} from './storage/search.js';
import {createStorageAdapter as createVectorAdapter} from './storage/vector.js';

test('registered command schemas reject missing input', () => {
  assert.throws(() => assertCommandInput({input_schema:{required:['data']}}, {}), error => error.code === 'command_validation_error');
});

test('registered command schemas validate declared primitive types', () => {
  assert.throws(() => assertCommandInput({input_schema:{properties:{quantity:{type:'integer'}}}}, {quantity:'1'}), error => error.code === 'command_validation_error');
  assert.doesNotThrow(() => assertCommandInput({input_schema:{properties:{quantity:{type:'integer'}}}}, {quantity:1}));
});

test('state transitions are resolved from the registered machine definition', () => {
  const machine = {transitions:{open:{start:{to:'in_progress'}}}};
  assert.deepEqual(assertTransition(machine, 'open', 'start'), {to:'in_progress'});
  assert.throws(() => assertTransition(machine, 'closed', 'start'), error => error.code === 'invalid_state_transition');
});

test('manifest values are configuration data, not handler constants', () => {
  assert.equal(manifestConfiguration('checkout', 'pricing', {}).freeShippingThreshold, 35);
  assert.equal(manifestConfiguration('pagination', 'defaults', {}).maxPageSize, 100);
});

test('registered product types validate nested attributes and fulfillment modes', () => {
  const type = {schema:{type:'object',required:['plan'],properties:{plan:{type:'string',minLength:1},components:{type:'array',items:{type:'object',required:['sku'],properties:{sku:{type:'string'}}}}}},fulfillment_modes:['delivery','download']};
  assert.doesNotThrow(() => validateProductType(type, {plan:'monthly',components:[{sku:'SKU-1'}],fulfillmentMode:'delivery'}));
  assert.throws(() => validateProductType(type, {plan:'',fulfillmentMode:'delivery'}), error => error.code === 'product_type_validation_error');
  assert.throws(() => validateProductType(type, {plan:'monthly',fulfillmentMode:'appointment'}), error => error.code === 'fulfillment_mode_not_supported');
  assert.throws(() => validateProductType(type, {plan:'monthly',components:[{}],fulfillmentMode:'download'}), error => error.code === 'product_type_validation_error');
});

test('provider credentials are encrypted and round-trip without plaintext storage format', () => {
  const credentials = {apiKey:'provider-secret',accountId:'acct_123'};
  const encrypted = encryptSecret(credentials);
  assert.notEqual(encrypted, JSON.stringify(credentials));
  assert.deepEqual(decryptSecret(encrypted), credentials);
});

test('storage capability profiles are explicit and normalized', () => {
  const profile = normalizeCapabilities({transactions:true, json:true, vectorSearch:true});
  assert.equal(profile.transactions, true);
  assert.equal(profile.json, true);
  assert.equal(profile.vectorSearch, true);
  assert.equal(profile.joins, false);
});

test('built-in non-relational adapters persist arbitrary portal resources', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marketly-adapters-'));
  const factories = [createDocumentAdapter, createKeyValueAdapter, createGraphAdapter, createSearchAdapter, createVectorAdapter];
  try {
    for (const [index, factory] of factories.entries()) {
      const adapter = await factory({storageFilePath:path.join(directory, `${index}.json`)});
      const context = {tenantId:'test', universeId:'main'};
      await adapter.resources.define(context, 'things', {displayName:'Things', schema:{columns:[{name:'title',type:'string',required:true},{name:'rank',type:'integer'}]}});
      const created = await adapter.resources.createRecord(context, 'things', {title:'Portable',rank:1});
      assert.equal(created.data.title, 'Portable');
      assert.equal((await adapter.resources.listRecords(context, 'things')).total, 1);
      await adapter.resources.updateRecord(context, 'things', created.id, {rank:2}, 1);
      assert.equal((await adapter.resources.getRecord(context, 'things', created.id)).data.rank, 2);
      await adapter.close();
    }
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
});
