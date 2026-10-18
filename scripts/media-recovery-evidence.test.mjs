import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashRecoverySection, compareRecoveryEvidence, recoveryConsistencyGate } from './media-recovery-evidence.mjs';
import { resumeMedia } from './media-recovery-coordinator.mjs';
const inventory = { deploymentId: 'deployment-one', authority: 'authority', stores: ['store-one', 'store-two'] };
const checkpoint = { version: 1, inventory, snapshots: ['authority', ...inventory.stores].map(canisterId => ({ canisterId, snapshotId: 'abcd' })) };
function evidence() {
  return { version: 1, deploymentId: inventory.deploymentId, registryRevision: 'revision-one', network: 'ic', host: 'https://icp-api.io',
    participants: checkpoint.snapshots.map(s => {
      const role = s.canisterId === inventory.authority ? 'authority' : 'store';
      const names = role === 'authority' ? ['quotaLedger', 'quotaJournal', 'storeRegistry'] : ['ciphertext', 'fileIndex', 'allocator', 'uploadJournal', 'ownership'];
      return { ...s, role, status: 'stopped', moduleHash: 'a'.repeat(64), subnetId: 'subnet-one',
        sections: Object.fromEntries(names.map(name => [name, { bytes: '10', sha256: 'b'.repeat(64) }])) };
    }) };
}
test('streaming hashes every byte independent of chunk boundaries', async () => {
  const actual = await hashRecoverySection([Buffer.from('abc'), Buffer.from('def')], 6n);
  assert.deepEqual(actual, { bytes: '6', sha256: createHash('sha256').update('abcdef').digest('hex') });
  assert.deepEqual(await hashRecoverySection([Buffer.from('abcdef')], 6n), actual);
});
test('truncated, oversized and invalid streams cannot produce evidence', async () => {
  for (const [chunks, size] of [[[Buffer.from('abc')], 4n], [[Buffer.from('abc')], 2n], [[Buffer.alloc(1_000_001)], 1_000_001n], [['abc'], 3n], [[Buffer.alloc(0)], 0n]]) {
    await assert.rejects(hashRecoverySection(chunks, size), /evidence/);
  }
  assert.equal((await hashRecoverySection([], 0n)).bytes, '0');
});
test('complete evidence is order-independent and matches exact checkpoint inventory', () => {
  const a = evidence(); const b = evidence(); b.participants.reverse();
  assert.equal(compareRecoveryEvidence(checkpoint, a, b), true);
  assert.equal(compareRecoveryEvidence({ ...checkpoint, snapshots: checkpoint.snapshots.slice(1) }, a, b), false);
});
test('every store and authority section independently rejects mismatches and omissions', () => {
  const baseline = evidence();
  for (let i = 0; i < baseline.participants.length; i++) {
    for (const name of Object.keys(baseline.participants[i].sections)) {
      const changed = evidence(); changed.participants[i].sections[name].sha256 = 'c'.repeat(64);
      assert.equal(compareRecoveryEvidence(checkpoint, baseline, changed), false, name);
      const missing = evidence(); delete missing.participants[i].sections[name];
      assert.equal(compareRecoveryEvidence(checkpoint, baseline, missing), false, name);
      const resized = evidence(); resized.participants[i].sections[name].bytes = '11';
      assert.equal(compareRecoveryEvidence(checkpoint, baseline, resized), false, name);
    }
  }
});
test('deployment, registry, network, host, subnet, module and snapshot changes deny', () => {
  const baseline = evidence();
  for (const [key, value] of [['deploymentId', 'other'], ['registryRevision', 'new'], ['network', 'engine'], ['host', 'https://other.example']]) {
    const changed = evidence(); changed[key] = value;
    assert.equal(compareRecoveryEvidence(checkpoint, baseline, changed), false, key);
  }
  for (const [key, value] of [['subnetId', 'other-subnet'], ['moduleHash', 'c'.repeat(64)], ['snapshotId', 'eeee'], ['status', 'running'], ['role', 'store']]) {
    const changed = evidence(); changed.participants[0][key] = value;
    assert.equal(compareRecoveryEvidence(checkpoint, baseline, changed), false, key);
  }
});
test('duplicate, missing, foreign and malformed evidence denies even if both sides match', () => {
  for (const mutate of [e => e.participants.pop(), e => e.participants[1] = e.participants[0],
    e => e.participants[1].canisterId = 'foreign', e => e.host = 'http://icp-api.io',
    e => e.host = 'https://user:password@icp-api.io', e => e.host = 'https://icp-api.io/path',
    e => e.participants[0].sections.quotaLedger.bytes = '-1',
    e => e.participants[0].sections.quotaLedger.sha256 = 'invalid',
    e => e.participants[0].sections.extra = { bytes: '0', sha256: 'b'.repeat(64) }]) {
    const bad = evidence(); mutate(bad);
    assert.equal(compareRecoveryEvidence(checkpoint, bad, bad), false);
  }
});
test('gate freezes baseline and denies unavailable verified state reads', async () => {
  const baseline = evidence(); const gate = recoveryConsistencyGate(baseline, async () => evidence());
  baseline.participants[0].sections.quotaLedger.sha256 = 'c'.repeat(64);
  assert.equal(await gate(checkpoint), true);
  assert.equal(await recoveryConsistencyGate(evidence(), async () => { throw new Error('Offline'); })(checkpoint), false);
  assert.equal(await recoveryConsistencyGate(evidence(), async () => null)(checkpoint), false);
});
test('coordinator never starts on mismatched content or ledger evidence', async () => {
  for (const name of ['ciphertext', 'quotaLedger']) {
    const calls = []; const changed = evidence();
    changed.participants[name === 'ciphertext' ? 1 : 0].sections[name].sha256 = 'c'.repeat(64);
    const adapter = { readInventory: async () => inventory, status: async () => 'stopped', start: async id => calls.push(id),
      verifyConsistency: recoveryConsistencyGate(evidence(), async () => changed) };
    await assert.rejects(resumeMedia(inventory, checkpoint, adapter, true), /consistency/);
    assert.deepEqual(calls, []);
  }
});
test('matching verified evidence permits authority-first approved resume', async () => {
  const calls = []; const states = new Map(checkpoint.snapshots.map(s => [s.canisterId, 'stopped']));
  const adapter = { readInventory: async () => inventory, status: async id => states.get(id),
    start: async id => { calls.push(id); states.set(id, 'running'); },
    verifyConsistency: recoveryConsistencyGate(evidence(), async () => evidence()) };
  await resumeMedia(inventory, checkpoint, adapter, true);
  assert.deepEqual(calls, ['authority', 'store-one', 'store-two']);
});
