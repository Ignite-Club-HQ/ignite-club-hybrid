// Offline tests for the protected private-name conversion tool. No network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateConversionRequest, assertNamesApproval, planConversions, buildConversionPlan,
  encryptName, nameReference, conversionJournal, convertOneAccount, withConversionWindow,
  reconcileConversion, CONFIRM_CONVERT,
} from './convert-private-names.mjs';

const SINK = 'rkp4c-7iaaa-aaaaa-aaaca-cai';
const SINK2 = 'r7inp-6aaaa-aaaaa-aaabq-cai';
const SUBJECT = '2vxsx-fae'; // anonymous-looking but valid textual principal for tests
const OWNER = 'aaaaa-aa'; // management canister textual form; validation is canister-side

const profile = (id, name, principals = [SUBJECT]) => ({ account_id: id, display_name: name, principals });

test('request validation gates live actions behind the names scope', () => {
  assert.doesNotThrow(() => validateConversionRequest({ action: 'check' }));
  assert.throws(() => validateConversionRequest({ action: 'convert' }), /names conversion approval/);
  assert.throws(() => validateConversionRequest({ action: 'convert', approvalScope: 'data' }), /names conversion approval/);
  assert.throws(() => validateConversionRequest({ action: 'convert', approvalScope: 'names', plan: 'x'.repeat(64) }), /Type CONVERT PRIVATE NAMES/);
  assert.doesNotThrow(() => validateConversionRequest({ action: 'convert', approvalScope: 'names', plan: 'a'.repeat(64), confirmation: CONFIRM_CONVERT }));
  assert.throws(() => validateConversionRequest({ action: 'wipe' }), /Action must be/);
});

test('approval must match the exact plan hash', () => {
  const approval = { action: 'convert', approvalScope: 'names', plan: 'b'.repeat(64), confirmation: CONFIRM_CONVERT };
  assert.doesNotThrow(() => assertNamesApproval(approval, 'b'.repeat(64)));
  assert.throws(() => assertNamesApproval(approval, 'c'.repeat(64)), /must match this plan/);
  assert.throws(() => assertNamesApproval({ action: 'check' }, 'b'.repeat(64)), /must match this plan/);
});

test('plan skips converted profiles but refuses foreign references', () => {
  const rows = planConversions({ profiles: [
    profile('a1', 'Paul Cranwell'),
    profile('a2', `pii-display-name:v1:${SINK}:${SUBJECT}`),
  ], sinks: [SINK] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accountId, 'a1');
  assert.throws(() => planConversions({ profiles: [profile('a3', `pii-display-name:v1:${SINK2}:${SUBJECT}`)], sinks: [SINK] }), /outside the inventory/);
  assert.throws(() => planConversions({ profiles: [profile('a4', '   ')], sinks: [SINK] }), /empty display name/);
  assert.throws(() => planConversions({ profiles: [profile('a5', 'Name', [])], sinks: [SINK] }), /no principal/);
});

test('plan hash binds rows, sinks and history revision', () => {
  const rows = [profile('a1', 'Paul')].map(p => ({ accountId: p.account_id, name: p.display_name, subject: SUBJECT }));
  const a = buildConversionPlan({ rows, sinks: [SINK], historyRevision: 7n });
  const b = buildConversionPlan({ rows, sinks: [SINK], historyRevision: 7n });
  assert.equal(a.hash, b.hash);
  assert.notEqual(buildConversionPlan({ rows, sinks: [SINK], historyRevision: 8n }).hash, a.hash);
  assert.notEqual(buildConversionPlan({ rows: [], sinks: [SINK], historyRevision: 7n }).hash, a.hash);
});

test('encryption is deterministic for resume safety', async () => {
  const { DerivedPublicKey, MasterPublicKey } = await import('../frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js');
  const { Principal } = await import('../frontend/node_modules/@icp-sdk/core/principal/index.js');
  const key = MasterPublicKey.productionKey('key_1').deriveCanisterKey(Principal.fromText(SINK).toUint8Array()).deriveSubKey(new TextEncoder().encode('ignite-pii-v1')).publicKeyBytes();
  const one = await encryptName(key, SUBJECT, 'Paul Cranwell');
  const two = await encryptName(key, SUBJECT, 'Paul Cranwell');
  assert.deepEqual(Array.from(one), Array.from(two));
  const other = await encryptName(key, SUBJECT, 'Someone Else');
  assert.notDeepEqual(Array.from(one), Array.from(other));
  assert.ok(DerivedPublicKey.deserialize(key));
});

test('nameReference builds the exact v1 binding', () => {
  assert.equal(nameReference(SINK, SUBJECT), `pii-display-name:v1:${SINK}:${SUBJECT}`);
});

function fakeDeps(overrides = {}) {
  const journal = conversionJournal('/tmp/nonexistent-conversion-journal.json');
  journal.put('__seed__', { phase: 'seed' }); // ensure file exists path works in-memory
  const stored = new Map();
  const deps = {
    journal,
    pii: {
      register_pii: async (id, field, ct, owner) => { stored.set(`${id}:${field}`, ct); },
      get_encrypted_pii_batch: async (ids, field) => ids.map(id => ({ pii_id: id, field_id: field, ciphertext: stored.get(`${id}:${field}`) })),
    },
    identity: {
      convert_profile_name: async (accountId, reference) => ({ account_id: accountId, display_name: reference }),
    },
    ...overrides,
  };
  return { deps, stored };
}

test('convertOneAccount encrypts, registers, verifies and publishes in order', async () => {
  const { deps } = fakeDeps();
  const row = { accountId: 'acct-1', name: 'Paul Cranwell', subject: SUBJECT };
  const ref = await convertOneAccount(SINK, await testKey(), row, deps);
  assert.equal(ref, nameReference(SINK, SUBJECT));
  assert.equal(deps.journal.get('acct-1').phase, 'converted');
  // Resume is a no-op.
  assert.equal(await convertOneAccount(SINK, await testKey(), row, deps), ref);
});

test('ciphertext mismatch refuses to publish the reference', async () => {
  const { deps } = fakeDeps();
  deps.pii.get_encrypted_pii_batch = async () => [{ pii_id: SUBJECT, field_id: 'display_name', ciphertext: [1, 2, 3] }];
  let converted = false;
  deps.identity.convert_profile_name = async () => { converted = true; return { display_name: 'x' }; };
  const key = await testKey();
  await assert.rejects(() => convertOneAccount(SINK, key, { accountId: 'acct-2', name: 'A', subject: SUBJECT }, deps), /ciphertext mismatch/);
  assert.equal(converted, false);
  assert.equal(deps.journal.get('acct-2').phase, 'registered');
});

test('unknown outcomes are retained and stop the run', async () => {
  const { deps } = fakeDeps();
  deps.journal.put('acct-3', { phase: 'unknown' });
  const key = await testKey();
  await assert.rejects(() => convertOneAccount(SINK, key, { accountId: 'acct-3', name: 'A', subject: SUBJECT }, deps), /Unknown outcome retained/);
});

test('window driver fences sinks before writers and seals before release', async () => {
  const order = [];
  const sinks = ['sink-a', 'sink-b'], writers = ['w1', 'w2', 'w3'];
  const state = { phase: 'Fencing', prepared: [], opened: [], sealed: [], completed: [] };
  const coordinator = {
    begin: async () => ({ ...state }),
    advance: async (op, target) => {
      order.push(target);
      if (state.phase === 'Fencing') { state.prepared.push(target); if (state.prepared.length === sinks.length) state.phase = 'Opening'; }
      else if (state.phase === 'Opening') { state.opened.push(target); if (state.opened.length === writers.length) state.phase = 'Writing'; }
      else if (state.phase === 'Closing') { state.sealed.push(target); if (state.sealed.length === writers.length) state.phase = 'Releasing'; }
      else if (state.phase === 'Releasing') { state.completed.push(target); if (state.completed.length === sinks.length) state.phase = 'Done'; }
      return { ...state };
    },
    close: async () => { state.phase = 'Closing'; return { ...state }; },
    read: async () => ({ ...state }),
  };
  let converted = false;
  const w = { sinks, writers, opened: [], sealed: [], completed: [] };
  const coord2 = { ...coordinator, begin: async () => ({ phase: 'Fencing', sinks, writers, opened: [], sealed: [], completed: [] }) };
  await withConversionWindow(coord2, 'op', 1n, async () => { converted = true; });
  assert.ok(converted);
  assert.deepEqual(order, ['sink-a', 'sink-b', 'w1', 'w2', 'w3', 'w1', 'w2', 'w3', 'sink-a', 'sink-b']);
  assert.equal(state.phase, 'Done');
});

test('window driver resumes an interrupted operation from its phase', async () => {
  const sinks = ['sink-a'], writers = ['w1'];
  const state = { phase: 'Opening', sinks, writers, opened: [], sealed: [], completed: [] };
  const coordinator = {
    begin: async () => ({ ...state }), // interrupted operation resumes, no second begin
    advance: async (op, target) => {
      if (state.phase === 'Opening') { state.opened.push(target); if (state.opened.length === writers.length) state.phase = 'Writing'; }
      else if (state.phase === 'Closing') { state.sealed.push(target); if (state.sealed.length === writers.length) state.phase = 'Releasing'; }
      else if (state.phase === 'Releasing') { state.completed.push(target); if (state.completed.length === sinks.length) state.phase = 'Done'; }
      return { ...state };
    },
    close: async () => { state.phase = 'Closing'; return { ...state }; },
    read: async () => ({ ...state }),
  };
  let ran = false;
  await withConversionWindow(coordinator, 'op', 1n, async () => { ran = true; });
  assert.ok(ran);
  assert.equal(state.phase, 'Done');
});

test('reconciliation refuses leftover plaintext or foreign references', () => {
  const good = reconcileConversion({ profiles: [profile('a1', `pii-display-name:v1:${SINK}:${SUBJECT}`)], sinks: [SINK] });
  assert.equal(good.converted, 1);
  assert.deepEqual(good.problems, []);
  const bad = reconcileConversion({ profiles: [profile('a2', 'Still Plain'), profile('a3', `pii-display-name:v1:${SINK2}:${SUBJECT}`)], sinks: [SINK] });
  assert.equal(bad.problems.length, 2);
});

async function testKey() {
  const { MasterPublicKey } = await import('../frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js');
  const { Principal } = await import('../frontend/node_modules/@icp-sdk/core/principal/index.js');
  return MasterPublicKey.productionKey('key_1').deriveCanisterKey(Principal.fromText(SINK).toUint8Array()).deriveSubKey(new TextEncoder().encode('ignite-pii-v1')).publicKeyBytes();
}
