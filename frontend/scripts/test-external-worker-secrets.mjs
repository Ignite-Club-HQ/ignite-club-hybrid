import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const host = 'http://127.0.0.1:4943';
const mappingsPath = path.resolve(repoRoot, '..', '.icp', 'cache', 'mappings', 'local.ids.json');
const mappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));

console.log('[WORKER_SECRETS] External Worker Secret Integration & Delivery Harness');
console.log(`[INFO] Queue Canister: ${mappings.notification_queue}`);
console.log(`[INFO] Secret Workload Canister: ${mappings.secret_workload_identity}`);

const jsonStr = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x);

// IDL Factory for secret_workload_identity
const secretIdl = ({ IDL }) => {
  const WorkloadIdentity = IDL.Record({
    'workload_principal': IDL.Principal,
    'workload_name': IDL.Text,
    'allowed_scopes': IDL.Vec(IDL.Text),
    'registered_at': IDL.Nat64,
    'last_used': IDL.Nat64,
    'status': IDL.Variant({ 'Active': IDL.Null, 'Suspended': IDL.Null, 'Revoked': IDL.Null }),
  });
  const SecretAccessResult = IDL.Record({
    'approved': IDL.Bool,
    'reason': IDL.Text,
    'timestamp': IDL.Nat64,
  });
  return IDL.Service({
    'initialize': IDL.Func([], [IDL.Variant({ 'Ok': IDL.Null, 'Err': IDL.Text })], []),
    'register_workload': IDL.Func([IDL.Principal, IDL.Text, IDL.Vec(IDL.Text)], [IDL.Variant({ 'Ok': WorkloadIdentity, 'Err': IDL.Text })], []),
    'verify_secret_access': IDL.Func([IDL.Principal, IDL.Text, IDL.Text], [SecretAccessResult], []),
  });
};

// IDL Factory for notification_queue
const queueIdl = ({ IDL }) => {
  const Notification = IDL.Record({
    'id': IDL.Text,
    'user': IDL.Text,
    'club': IDL.Text,
    'kind': IDL.Text,
    'body': IDL.Text,
    'idempotency_key': IDL.Text,
    'attempts': IDL.Nat32,
    'next_attempt_ms': IDL.Nat64,
    'status': IDL.Variant({ 'Pending': IDL.Null, 'Processing': IDL.Null, 'Delivered': IDL.Null, 'Failed': IDL.Null }),
  });
  return IDL.Service({
    'initialize': IDL.Func([], [IDL.Variant({ 'Ok': IDL.Null, 'Err': IDL.Text })], []),
    'grant_worker': IDL.Func([IDL.Principal], [IDL.Variant({ 'Ok': IDL.Null, 'Err': IDL.Text })], []),
    'enqueue': IDL.Func([IDL.Text, IDL.Text, IDL.Text, IDL.Text, IDL.Text, IDL.Text], [IDL.Variant({ 'Ok': Notification, 'Err': IDL.Text })], []),
    'claim': IDL.Func([IDL.Nat64, IDL.Nat16], [IDL.Variant({ 'Ok': IDL.Vec(Notification), 'Err': IDL.Text })], []),
    'acknowledge': IDL.Func([IDL.Text, IDL.Text], [IDL.Variant({ 'Ok': Notification, 'Err': IDL.Text })], []),
  });
};

const governorIdentity = syntheticIdentity('governor');
const governorAgent = await HttpAgent.create({ host, identity: governorIdentity, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const secretActor = Actor.createActor(secretIdl, { agent: governorAgent, canisterId: mappings.secret_workload_identity });
const queueActor = Actor.createActor(queueIdl, { agent: governorAgent, canisterId: mappings.notification_queue });

// Identities for simulated workers
const emailWorkerIdentity = syntheticIdentity('club_admin');
const pushWorkerIdentity = syntheticIdentity('outsider');

// Simulated local worker vault (In production: stored in Cloudflare Secrets / AWS Secrets Manager)
const simulatedWorkerVault = {
  emailWorker: {
    RESEND_API_KEY: 're_synthetic_test_key_12345',
  },
  pushWorker: {
    FCM_SERVICE_ACCOUNT: '{"project_id":"synthetic-ignite-lab","private_key":"-----BEGIN PRIVATE KEY-----..."}',
    VAPID_PRIVATE_KEY: 'synthetic_vapid_private_ecdsa_key',
  },
  paymentsGateway: {
    STRIPE_SECRET_KEY: 'sk_test_synthetic_stripe_key_abcde',
    STRIPE_WEBHOOK_SECRET: 'whsec_synthetic_webhook_secret_9999',
  },
};

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

// 1. Initialize Canisters & Register Worker Identites
await runTest('Worker Registration & Queue Setup', async () => {
  await queueActor.initialize();
  await secretActor.initialize();

  // Register Email Worker in secret_workload_identity with email scope
  const regEmail = await secretActor.register_workload(
    emailWorkerIdentity.getPrincipal(),
    'ignite-email-delivery-worker',
    ['send-email-notification']
  );
  assert('Ok' in regEmail, jsonStr(regEmail));

  // Grant queue worker capability to email worker in notification_queue
  const grantEmailQueue = await queueActor.grant_worker(emailWorkerIdentity.getPrincipal());
  assert('Ok' in grantEmailQueue || ('Err' in grantEmailQueue && grantEmailQueue.Err === 'Already granted'), jsonStr(grantEmailQueue));

  // Register Push Worker in secret_workload_identity with push scope
  const regPush = await secretActor.register_workload(
    pushWorkerIdentity.getPrincipal(),
    'ignite-push-delivery-worker',
    ['send-push-notification']
  );
  assert('Ok' in regPush, jsonStr(regPush));
})();

// 2. Email Delivery Worker Flow (Queue Pull + Secret Access + Mock Dispatch + Ack)
await runTest('Email Delivery Worker Flow with RESEND_API_KEY custody', async () => {
  const jobId = `email-job-${Date.now()}`;
  const idempotencyKey = `email-key-${Date.now()}`;

  // Step 1: Canister enqueues email notification
  const enq = await queueActor.enqueue(
    jobId,
    'user-parent-123',
    'club-alpha',
    'email_rsvp_reminder',
    JSON.stringify({ to: 'parent@example.com', subject: 'Match RSVP Reminder' }),
    idempotencyKey
  );
  assert('Ok' in enq, jsonStr(enq));

  // Step 2: Email worker claims job from queue
  const emailWorkerAgent = await HttpAgent.create({ host, identity: emailWorkerIdentity, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
  const emailWorkerQueue = Actor.createActor(queueIdl, { agent: emailWorkerAgent, canisterId: mappings.notification_queue });
  const emailWorkerSecret = Actor.createActor(secretIdl, { agent: emailWorkerAgent, canisterId: mappings.secret_workload_identity });

  const claimRes = await emailWorkerQueue.claim(BigInt(Date.now()), 10);
  assert('Ok' in claimRes, jsonStr(claimRes));
  const claimedJob = claimRes.Ok.find(j => j.id === jobId);
  assert(claimedJob, 'Worker must claim the enqueued email job');

  // Step 3: Worker verifies secret authorization against secret_workload_identity
  const authRes = await emailWorkerSecret.verify_secret_access(
    emailWorkerIdentity.getPrincipal(),
    'send-email-notification',
    `nonce-${Date.now()}`
  );
  assert.equal(authRes.approved, true, 'Email worker must be approved for send-email-notification');

  // Step 4: Worker retrieves RESEND_API_KEY from its own local vault environment
  const apiKey = simulatedWorkerVault.emailWorker.RESEND_API_KEY;
  assert.equal(apiKey.startsWith('re_'), true, 'Worker successfully accesses vault secret');

  // Step 5: Worker acknowledges/completes job on-chain
  const comp = await emailWorkerQueue.acknowledge(jobId, idempotencyKey);
  assert('Ok' in comp, jsonStr(comp));
  assert('Delivered' in comp.Ok.status, 'Job marked Delivered in canister queue');
})();

// 3. Push Delivery Worker Scope Isolation (Least Privilege)
await runTest('Push Delivery Worker Scope Isolation', async () => {
  const pushWorkerAgent = await HttpAgent.create({ host, identity: pushWorkerIdentity, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
  const pushWorkerSecret = Actor.createActor(secretIdl, { agent: pushWorkerAgent, canisterId: mappings.secret_workload_identity });

  // Push worker requests push scope - APPROVED
  const pushAuth = await pushWorkerSecret.verify_secret_access(
    pushWorkerIdentity.getPrincipal(),
    'send-push-notification',
    `nonce-${Date.now()}`
  );
  assert.equal(pushAuth.approved, true);

  // Push worker requests payment scope - DENIED
  const paymentAuth = await pushWorkerSecret.verify_secret_access(
    pushWorkerIdentity.getPrincipal(),
    'payment-processor',
    `nonce-${Date.now()}`
  );
  assert.equal(paymentAuth.approved, false, 'Push worker must not be able to access payment secrets');
})();

console.log(`\n=== External Worker Secrets Harness Summary ===`);
console.log(`[PASS] ${passed} tests passed`);
console.log(`[FAIL] ${failed} tests failed`);
if (failed > 0) process.exit(1);
