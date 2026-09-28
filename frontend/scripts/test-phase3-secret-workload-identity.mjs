import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';

const host = 'http://127.0.0.1:4943';
const mappings = JSON.parse(fs.readFileSync('.icp/cache/mappings/local.ids.json', 'utf8'));
const canisterId = mappings.secret_workload_identity;

console.log('[PHASE3] Secret Workload Identity Integration Test Suite');
console.log(`[INFO] Canister ID: ${canisterId}`);

const jsonStr = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x);

// Candid IDL for secret_workload_identity
const idlFactory = ({ IDL }) => {
  const WorkloadIdentity = IDL.Record({
    'workload_principal': IDL.Principal,
    'workload_name': IDL.Text,
    'allowed_scopes': IDL.Vec(IDL.Text),
    'registered_at': IDL.Nat64,
    'last_used': IDL.Nat64,
    'status': IDL.Variant({
      'Active': IDL.Null,
      'Suspended': IDL.Null,
      'Revoked': IDL.Null,
    }),
  });
  const SecretAccessAudit = IDL.Record({
    'timestamp': IDL.Nat64,
    'requesting_principal': IDL.Principal,
    'workload_name': IDL.Text,
    'secret_scope': IDL.Text,
    'approved': IDL.Bool,
    'denial_reason': IDL.Opt(IDL.Text),
    'nonce': IDL.Text,
  });
  const SecretAccessResult = IDL.Record({
    'approved': IDL.Bool,
    'reason': IDL.Text,
    'timestamp': IDL.Nat64,
  });
  const WorkloadIdentityFilter = IDL.Record({
    'opt_principal': IDL.Opt(IDL.Principal),
    'opt_scope': IDL.Opt(IDL.Text),
    'opt_from_ts': IDL.Opt(IDL.Nat64),
    'opt_to_ts': IDL.Opt(IDL.Nat64),
  });
  const AuditSummary = IDL.Record({
    'total_accesses': IDL.Nat64,
    'approved': IDL.Nat64,
    'denied': IDL.Nat64,
  });

  return IDL.Service({
    'initialize': IDL.Func([], [IDL.Variant({ 'Ok': IDL.Null, 'Err': IDL.Text })], []),
    'register_workload': IDL.Func([IDL.Principal, IDL.Text, IDL.Vec(IDL.Text)], [IDL.Variant({ 'Ok': WorkloadIdentity, 'Err': IDL.Text })], []),
    'verify_secret_access': IDL.Func([IDL.Principal, IDL.Text, IDL.Text], [SecretAccessResult], []),
    'get_workload': IDL.Func([IDL.Principal], [IDL.Variant({ 'Ok': WorkloadIdentity, 'Err': IDL.Text })], ['query']),
    'list_workloads': IDL.Func([], [IDL.Vec(WorkloadIdentity)], ['query']),
    'update_workload_scopes': IDL.Func([IDL.Principal, IDL.Vec(IDL.Text)], [IDL.Variant({ 'Ok': WorkloadIdentity, 'Err': IDL.Text })], []),
    'audit_secret_access': IDL.Func([WorkloadIdentityFilter], [IDL.Vec(SecretAccessAudit)], ['query']),
    'revoke_workload': IDL.Func([IDL.Principal], [IDL.Variant({ 'Ok': IDL.Null, 'Err': IDL.Text })], []),
    'get_audit_summary': IDL.Func([], [AuditSummary], ['query']),
  });
};

const governorIdentity = syntheticIdentity('governor');
const governorAgent = await HttpAgent.create({ host, identity: governorIdentity, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const governor = Actor.createActor(idlFactory, { agent: governorAgent, canisterId });

const workerIdentity = syntheticIdentity('club_admin');
const outsiderIdentity = syntheticIdentity('outsider');

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

// 1. Initialize Canister
await runTest('Initialize Canister', async () => {
  const res = await governor.initialize();
  assert('Ok' in res || ('Err' in res && res.Err === 'Already initialized'), jsonStr(res));
})();

// 2. Register Workload (Timer worker with push-notification scope)
await runTest('Register Workload (Push Notification Worker)', async () => {
  const res = await governor.register_workload(
    workerIdentity.getPrincipal(),
    'push-notification-worker',
    ['send-push-notification', 'write-audit-log']
  );
  assert('Ok' in res, jsonStr(res));
  assert.equal(res.Ok.workload_name, 'push-notification-worker');
  assert.deepEqual(res.Ok.allowed_scopes, ['send-push-notification', 'write-audit-log']);
})();

// 3. Verify Allowed Access
await runTest('Verify Allowed Secret Access', async () => {
  const res = await governor.verify_secret_access(
    workerIdentity.getPrincipal(),
    'send-push-notification',
    'nonce-12345'
  );
  assert.equal(res.approved, true);
})();

// 4. Verify Denied Access (Unregistered Scope)
await runTest('Verify Denied Secret Access (Unregistered Scope)', async () => {
  const res = await governor.verify_secret_access(
    workerIdentity.getPrincipal(),
    'payment-processor',
    'nonce-12346'
  );
  assert.equal(res.approved, false);
})();

// 5. Verify Denied Access (Unregistered Principal)
await runTest('Verify Denied Secret Access (Unregistered Principal)', async () => {
  const res = await governor.verify_secret_access(
    outsiderIdentity.getPrincipal(),
    'send-push-notification',
    'nonce-12347'
  );
  assert.equal(res.approved, false);
})();

// 6. Reject Invalid Scope on Registration
await runTest('Reject Invalid Scope on Registration', async () => {
  const res = await governor.register_workload(
    outsiderIdentity.getPrincipal(),
    'rogue-worker',
    ['invalid-custom-scope']
  );
  assert('Err' in res, 'Expected rejection of invalid scope');
})();

// 7. Get Workload Details
await runTest('Get Workload Details', async () => {
  const res = await governor.get_workload(workerIdentity.getPrincipal());
  assert('Ok' in res, jsonStr(res));
  assert.equal(res.Ok.workload_name, 'push-notification-worker');
})();

// 8. List Workloads
await runTest('List Workloads', async () => {
  const list = await governor.list_workloads();
  assert(list.length >= 1, `Expected at least 1 workload, got ${list.length}`);
  assert(list.some(w => w.workload_name === 'push-notification-worker'));
})();

// 9. Update Workload Scopes
await runTest('Update Workload Scopes', async () => {
  const res = await governor.update_workload_scopes(
    workerIdentity.getPrincipal(),
    ['send-push-notification', 'send-email-notification', 'write-audit-log']
  );
  assert('Ok' in res, jsonStr(res));
  assert.deepEqual(res.Ok.allowed_scopes, ['send-push-notification', 'send-email-notification', 'write-audit-log']);
})();

// 10. Verify Updated Scope Access
await runTest('Verify Updated Scope Access (Email Notification)', async () => {
  const res = await governor.verify_secret_access(
    workerIdentity.getPrincipal(),
    'send-email-notification',
    'nonce-12348'
  );
  assert.equal(res.approved, true);
})();

// 11. Query Audit Trail
await runTest('Query Secret Access Audit Trail', async () => {
  const filter = {
    opt_principal: [],
    opt_scope: ['send-push-notification'],
    opt_from_ts: [],
    opt_to_ts: [],
  };
  const logs = await governor.audit_secret_access(filter);
  assert(logs.length >= 1, `Expected at least 1 audit entry, got ${logs.length}`);
  assert(logs.some(l => l.secret_scope === 'send-push-notification' && l.approved === true));
})();

// 12. Get Audit Summary
await runTest('Get Audit Summary', async () => {
  const summary = await governor.get_audit_summary();
  assert(summary.total_accesses >= 4n, `Expected >= 4 accesses, got ${summary.total_accesses}`);
  assert(summary.approved >= 2n, `Expected >= 2 approved, got ${summary.approved}`);
  assert(summary.denied >= 2n, `Expected >= 2 denied, got ${summary.denied}`);
})();

// 13. Revoke Workload
await runTest('Revoke Workload', async () => {
  const res = await governor.revoke_workload(workerIdentity.getPrincipal());
  assert('Ok' in res, jsonStr(res));

  // Access must be denied after revocation
  const check = await governor.verify_secret_access(
    workerIdentity.getPrincipal(),
    'send-push-notification',
    'nonce-12349'
  );
  assert.equal(check.approved, false);
})();

console.log(`\n=== Test Summary ===`);
console.log(`[PASS] ${passed} tests passed`);
console.log(`[FAIL] ${failed} tests failed`);
if (failed > 0) process.exit(1);
