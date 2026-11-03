import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBundle} from './capabilities.js';

test('capability bundles require a valid runtime registration shape', () => {
  assert.throws(() => validateBundle({}), error => error.code === 'bundle_validation_error');
  assert.doesNotThrow(() => validateBundle({key:'video',version:1,modules:[{key:'video',displayName:'Video',capabilities:{streaming:true}}],entities:[],relationships:[],commands:[],stateMachines:[],workflows:[]}));
});

test('capability bundle keys reject unsafe or ambiguous identifiers', () => {
  assert.throws(() => validateBundle({key:'../video'}), error => error.code === 'bundle_validation_error');
  assert.throws(() => validateBundle({key:'Video'}), error => error.code === 'bundle_validation_error');
});
