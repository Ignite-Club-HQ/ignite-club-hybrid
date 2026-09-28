import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';

const host = 'http://127.0.0.1:4943';
const mappings = JSON.parse(fs.readFileSync('.icp/cache/mappings/local.ids.json', 'utf8'));

console.log('[INTEGRATION] End-to-End PII & Vault Workload Identity Suite');
console.log(`[INFO] PII Canister: ${mappings.pii_access_control}`);
console.log(`[INFO] Secret Canister: ${mappings.secret_workload_identity}`);

const jsonStr = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x);

// IDL Factories
const piiIdl = ({ IDL }) => {
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
  });
};

const secretIdl = ({ IDL }) => {
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
    'audit_secret_access': IDL.Func([WorkloadIdentityFilter], [IDL.Vec(SecretAccessAudit)], ['query']),
    'get_audit_summary': IDL.Func([], [AuditSummary], ['query']),
  });
};

const governorIdentity = syntheticIdentity('governor');
const governorAgent = await HttpAgent.create({ host, identity: governorIdentity, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const piiActor = Actor.createActor(piiIdl, { agent: governorAgent, canisterId: mappings.pii_access_control });
const secretActor = Actor.createActor(secretIdl, { agent: governorAgent, canisterId: mappings.secret_workload_identity });

const notificationWorkerIdentity = syntheticIdentity('club_admin');
const emailWorkerIdentity = syntheticIdentity('outsider');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  return async () => {
    try {
      console.log(`[SCENARIO] Starting: ${name}`);
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}: ${e.message}`);
      failed++;
    }
  };
}

// SCENARIO 1: End-to-End Child Profile Protection
await runTest('Scenario 1: Child Profile Protection & Media Key Derivation', async () => {
  // Step 1: Register parent/child email as PII
  const emailBytes = Array.from(Buffer.from('parent@example.com', 'utf8'));
  const regEmail = await piiActor.register_pii('child-profile-001', 'guardian_email', emailBytes, governorIdentity.getPrincipal());
  assert('Ok' in regEmail, jsonStr(regEmail));

  // Step 2: Register child photo reference as PII
  const photoPathBytes = Array.from(Buffer.from('/protected/photos/child-001.webp', 'utf8'));
  const regPhoto = await piiActor.register_pii('child-profile-001', 'photo_path', photoPathBytes, governorIdentity.getPrincipal());
  assert('Ok' in regPhoto, jsonStr(regPhoto));

  // Step 3: Derive ephemeral media key for approved viewer
  const mediaKey = await piiActor.derive_media_key('child-profile-001', governorIdentity.getPrincipal(), 'coach_team_roster_view', 1800n);
  assert('Ok' in mediaKey, jsonStr(mediaKey));
  assert(mediaKey.Ok.length >= 6, 'Derived key must contain expected bytes');

  // Step 4: Verify decrypted PII accessible to authorized governor
  const decrypted = await piiActor.get_decrypted_pii('child-profile-001', 'guardian_email', 'roster_audit', 'compliance_verification');
  assert('Ok' in decrypted, jsonStr(decrypted));
  assert.equal(Buffer.from(decrypted.Ok.plaintext).toString('utf8'), 'parent@example.com');
})();

// SCENARIO 2: Worker Identity Verification for Vault Secret Access
await runTest('Scenario 2: Worker Identity Verification for Vault Secret Access', async () => {
  // Step 1: Register notification worker with push scope
  const regWorker = await secretActor.register_workload(
    notificationWorkerIdentity.getPrincipal(),
    'notification-dispatch-worker',
    ['send-push-notification', 'write-audit-log']
  );
  assert('Ok' in regWorker, jsonStr(regWorker));

  // Step 2: Worker requests push secret - APPROVED
  const pushAccess = await secretActor.verify_secret_access(
    notificationWorkerIdentity.getPrincipal(),
    'send-push-notification',
    'nonce-push-001'
  );
  assert.equal(pushAccess.approved, true);

  // Step 3: Worker requests payment secret - DENIED (least privilege)
  const paymentAccess = await secretActor.verify_secret_access(
    notificationWorkerIdentity.getPrincipal(),
    'payment-processor',
    'nonce-pay-001'
  );
  assert.equal(paymentAccess.approved, false);
})();

// SCENARIO 3: Cross-Canister Audit Trail & Verification
await runTest('Scenario 3: Audit Trail Integrity Across PII and Vault Canisters', async () => {
  // Check PII audit log
  const piiLogs = await piiActor.audit_access({
    opt_principal: [],
    opt_field_id: [],
    opt_pii_id: ['child-profile-001'],
    opt_from_ts: [],
    opt_to_ts: [],
  });
  assert(piiLogs.length >= 2, `Expected >= 2 PII audit entries, got ${piiLogs.length}`);

  // Check secret audit log - filter by scope or principal
  const secretLogs = await secretActor.audit_secret_access({
    opt_principal: [governorIdentity.getPrincipal()],
    opt_scope: [],
    opt_from_ts: [],
    opt_to_ts: [],
  });
  assert(secretLogs.length >= 2, `Expected >= 2 secret audit entries for caller, got ${secretLogs.length}`);

  // Check secret audit summary
  const summary = await secretActor.get_audit_summary();
  assert(summary.total_accesses >= 2n, 'Expected positive total accesses');
})();

// SCENARIO 4: Cryptographic Erasure (GDPR / Privacy Compliance)
await runTest('Scenario 4: Cryptographic Erasure Verification', async () => {
  const ssnBytes = Array.from(Buffer.from('999-00-1234', 'utf8'));
  await piiActor.register_pii('gdpr-erasure-target', 'ssn', ssnBytes, governorIdentity.getPrincipal());

  // Confirm it exists
  const beforeDelete = await piiActor.get_encrypted_pii('gdpr-erasure-target', 'ssn');
  assert('Ok' in beforeDelete, 'PII should exist before erasure');

  // Perform cryptographic erasure
  const delRes = await piiActor.delete_pii('gdpr-erasure-target', 'ssn');
  assert('Ok' in delRes, jsonStr(delRes));
  assert.equal(delRes.Ok.key_destroyed, true);

  // Confirm it is gone
  const afterDelete = await piiActor.get_encrypted_pii('gdpr-erasure-target', 'ssn');
  assert('Err' in afterDelete, 'PII must not be retrievable after erasure');
})();

// SCENARIO 5: Multi-Worker Isolation (Least Privilege)
await runTest('Scenario 5: Multi-Worker Least Privilege Scope Isolation', async () => {
  // Register email worker with email-only scope
  await secretActor.register_workload(
    emailWorkerIdentity.getPrincipal(),
    'email-dispatch-worker',
    ['send-email-notification']
  );

  // Email worker can send email
  const emailAllowed = await secretActor.verify_secret_access(
    emailWorkerIdentity.getPrincipal(),
    'send-email-notification',
    'nonce-email-001'
  );
  assert.equal(emailAllowed.approved, true);

  // Email worker CANNOT send push
  const pushDenied = await secretActor.verify_secret_access(
    emailWorkerIdentity.getPrincipal(),
    'send-push-notification',
    'nonce-push-002'
  );
  assert.equal(pushDenied.approved, false);
})();

console.log(`\n=== Integration Test Summary ===`);
console.log(`[PASS] ${passed} scenarios passed`);
console.log(`[FAIL] ${failed} scenarios failed`);
if (failed > 0) process.exit(1);
