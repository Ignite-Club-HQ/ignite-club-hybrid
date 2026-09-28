import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';

const host = 'http://127.0.0.1:4943';
const mappings = JSON.parse(fs.readFileSync('.icp/cache/mappings/local.ids.json', 'utf8'));
const canisterId = mappings.pii_access_control;

console.log('[PHASE1] PII Access Control Integration Test Suite');
console.log(`[INFO] Canister ID: ${canisterId}`);

const jsonStr = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x);

// Candid IDL for pii_access_control
const idlFactory = ({ IDL }) => {
  const EncryptedPii = IDL.Record({
    'pii_id': IDL.Text,
    'field_id': IDL.Text,
    'ciphertext': IDL.Vec(IDL.Nat8),
    'nonce': IDL.Vec(IDL.Nat8),
    'master_key_id': IDL.Text,
  });
  const DecryptedPii = IDL.Record({
    'pii_id': IDL.Text,
    'field_id': IDL.Text,
    'plaintext': IDL.Vec(IDL.Nat8),
  });
  const AuditRecord = IDL.Record({
    'timestamp': IDL.Nat64,
    'requesting_principal': IDL.Principal,
    'pii_id': IDL.Text,
    'field_id': IDL.Text,
    'operation': IDL.Text,
    'allowed': IDL.Bool,
    'purpose': IDL.Text,
  });
  const PiiDeleteResult = IDL.Record({
    'shredded_at': IDL.Nat64,
    'key_destroyed': IDL.Bool,
  });
  const KeyMetadata = IDL.Record({
    'key_id': IDL.Text,
    'created_at': IDL.Nat64,
    'rotation_due_at': IDL.Nat64,
    'status': IDL.Variant({
      'Active': IDL.Null,
      'RotationPending': IDL.Null,
      'Revoked': IDL.Null,
      'Shredded': IDL.Null,
    }),
  });
  const KeyRotationResult = IDL.Record({
    'rotated_at': IDL.Nat64,
    'old_key_id': IDL.Text,
    'new_key_id': IDL.Text,
  });
  const AuditFilter = IDL.Record({
    'opt_principal': IDL.Opt(IDL.Principal),
    'opt_field_id': IDL.Opt(IDL.Text),
    'opt_pii_id': IDL.Opt(IDL.Text),
    'opt_from_ts': IDL.Opt(IDL.Nat64),
    'opt_to_ts': IDL.Opt(IDL.Nat64),
  });

  return IDL.Service({
    'initialize_master_key': IDL.Func([IDL.Text], [IDL.Variant({ 'Ok': IDL.Text, 'Err': IDL.Text })], []),
    'register_pii': IDL.Func([IDL.Text, IDL.Text, IDL.Vec(IDL.Nat8), IDL.Principal], [IDL.Variant({ 'Ok': EncryptedPii, 'Err': IDL.Text })], []),
    'get_encrypted_pii': IDL.Func([IDL.Text, IDL.Text], [IDL.Variant({ 'Ok': EncryptedPii, 'Err': IDL.Text })], ['query']),
    'get_decrypted_pii': IDL.Func([IDL.Text, IDL.Text, IDL.Text, IDL.Text], [IDL.Variant({ 'Ok': DecryptedPii, 'Err': IDL.Text })], []),
    'derive_media_key': IDL.Func([IDL.Text, IDL.Principal, IDL.Text, IDL.Nat64], [IDL.Variant({ 'Ok': IDL.Vec(IDL.Nat8), 'Err': IDL.Text })], []),
    'delete_pii': IDL.Func([IDL.Text, IDL.Text], [IDL.Variant({ 'Ok': PiiDeleteResult, 'Err': IDL.Text })], []),
    'audit_access': IDL.Func([AuditFilter], [IDL.Vec(AuditRecord)], ['query']),
    'rotate_key': IDL.Func([IDL.Text], [IDL.Variant({ 'Ok': KeyRotationResult, 'Err': IDL.Text })], []),
    'get_key_metadata': IDL.Func([], [IDL.Vec(KeyMetadata)], ['query']),
    'emergency_shutdown': IDL.Func([], [IDL.Variant({ 'Ok': IDL.Null, 'Err': IDL.Text })], []),
  });
};

const governorIdentity = syntheticIdentity('governor');
const governorAgent = await HttpAgent.create({ host, identity: governorIdentity, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const governor = Actor.createActor(idlFactory, { agent: governorAgent, canisterId });

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  return async () => {
    try {
      console.log(`[TEST] Starting: ${name}`);
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}: ${e.message}`);
      failed++;
    }
  };
}

// 1. Initialize Master Key
await runTest('Initialize Master Key', async () => {
  const res = await governor.initialize_master_key('master-key-2026-09-13');
  assert('Ok' in res, jsonStr(res));
  assert.equal(res.Ok, 'master-key-2026-09-13');
})();

// 2. Register PII (Encrypt & Store)
const testPlaintext = Array.from(Buffer.from('John Doe', 'utf8'));
await runTest('Register PII (Encrypt & Store)', async () => {
  const res = await governor.register_pii('user-123', 'full_name', testPlaintext, governorIdentity.getPrincipal());
  assert('Ok' in res, jsonStr(res));
  assert.equal(res.Ok.pii_id, 'user-123');
  assert.equal(res.Ok.field_id, 'full_name');
  assert.equal(res.Ok.master_key_id, 'master-key-2026-09-13');
  assert.notDeepEqual(Array.from(res.Ok.ciphertext), testPlaintext);
})();

// 3. Retrieve Encrypted PII (No Decryption)
await runTest('Retrieve Encrypted PII (No Decryption)', async () => {
  const res = await governor.get_encrypted_pii('user-123', 'full_name');
  assert('Ok' in res, jsonStr(res));
  assert.equal(res.Ok.pii_id, 'user-123');
  assert.equal(res.Ok.field_id, 'full_name');
  assert.notDeepEqual(Array.from(res.Ok.ciphertext), testPlaintext);
})();

// 4. Decrypt PII (Authorized Access)
await runTest('Decrypt PII (Authorized Access)', async () => {
  const res = await governor.get_decrypted_pii('user-123', 'full_name', 'read', 'display_profile');
  assert('Ok' in res, jsonStr(res));
  assert.equal(res.Ok.pii_id, 'user-123');
  const decryptedText = Buffer.from(res.Ok.plaintext).toString('utf8');
  assert.equal(decryptedText, 'John Doe');
})();

// 5. Query Audit Trail (Field-Level Access Log)
await runTest('Query Audit Trail (Field-Level Access Log)', async () => {
  const filter = {
    opt_principal: [],
    opt_field_id: [],
    opt_pii_id: ['user-123'],
    opt_from_ts: [],
    opt_to_ts: [],
  };
  const logs = await governor.audit_access(filter);
  assert(logs.length >= 2, `Expected at least 2 audit entries, got ${logs.length}`);
  assert(logs.some(l => l.operation === 'register' && l.allowed === true));
  assert(logs.some(l => l.operation === 'read' && l.allowed === true));
})();

// 6. Rotate Master Key
await runTest('Rotate Master Key', async () => {
  const res = await governor.rotate_key('master-key-2026-09-14');
  assert('Ok' in res, jsonStr(res));
  assert.equal(res.Ok.old_key_id, 'master-key-2026-09-13');
  assert.equal(res.Ok.new_key_id, 'master-key-2026-09-14');
})();

// 7. Get Key Metadata
await runTest('Get Key Metadata', async () => {
  const metadata = await governor.get_key_metadata();
  assert(metadata.length >= 2, `Expected at least 2 key metadata entries, got ${metadata.length}`);
  assert(metadata.some(m => m.key_id === 'master-key-2026-09-14' && 'Active' in m.status));
  assert(metadata.some(m => m.key_id === 'master-key-2026-09-13' && 'RotationPending' in m.status));
})();

// 8. Delete PII (Cryptographic Erasure)
await runTest('Delete PII (Cryptographic Erasure)', async () => {
  const emailBytes = Array.from(Buffer.from('test@example.com', 'utf8'));
  const reg = await governor.register_pii('user-456', 'email', emailBytes, governorIdentity.getPrincipal());
  assert('Ok' in reg, jsonStr(reg));

  const del = await governor.delete_pii('user-456', 'email');
  assert('Ok' in del, jsonStr(del));
  assert.equal(del.Ok.key_destroyed, true);

  // Subsequent get must fail
  const getEncrypted = await governor.get_encrypted_pii('user-456', 'email');
  assert('Err' in getEncrypted, 'Expected PII not found after deletion');
})();

// 9. Derive Media Key (for Child Photos)
await runTest('Derive Media Key (for Child Photos)', async () => {
  const res = await governor.derive_media_key('child-789', governorIdentity.getPrincipal(), 'view_child_photos', 3600n);
  assert('Ok' in res, jsonStr(res));
  assert(res.Ok.length >= 6, 'Expected derived key bytes');
})();

console.log(`\n=== Test Summary ===`);
console.log(`[PASS] ${passed} tests passed`);
console.log(`[FAIL] ${failed} tests failed`);
if (failed > 0) process.exit(1);
