import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRequest, validateTargets, validateJournal, runFill, digest, PINNED, requireLookupReleaseAcceptance } from './membership-lookup-release-policy.mjs';

const targets = [
  { canisterId: PINNED.identity, groupId: 'shared', name: 'identity_access', subnetId: 'subnet', newHash: 'a'.repeat(64) },
  ...['g1', 'g2'].map(groupId => ({ canisterId: PINNED[groupId], groupId, name: 'club_domain', subnetId: 'subnet', newHash: 'b'.repeat(64) })),
];
const binding = { targets, governor: 'gov' };
const step = t => ({ ...t, oldHash: 'c'.repeat(64), settingsHash: 'd'.repeat(64), phase: 'complete' });
const journal = (overrides = {}) => ({ binding, complete: true, steps: targets.map(step), fill: { g1: true, g2: true }, ...overrides });

test('requires the exact confirmation and exactly the three existing lookup targets', () => {
  validateRequest('upgrade', ' RELEASE MEMBERSHIP LOOKUP\n'); validateRequest('check', '');
  assert.throws(() => validateRequest('upgrade', 'UPGRADE BOTH GROUPS PHOTOS'));
  validateTargets(targets);
  assert.throws(() => validateTargets([...targets, targets[0]]));
  assert.throws(() => validateTargets(targets.filter(t => t.name !== 'identity_access')));
  assert.throws(() => validateTargets(targets.map(t => ({ ...t, name: 'media_metadata' }))));
  assert.throws(() => validateTargets(targets.map(t => t.groupId === 'g2' ? { ...t, canisterId: PINNED.g1 } : t)));
});

test('repository mappings match the pinned lookup services', () => {
  const root = new URL('../', import.meta.url);
  const shared = JSON.parse(readFileSync(new URL('deploy/mainnet/.icp/data/mappings/ic.ids.json', root)));
  const provision = JSON.parse(readFileSync(new URL('deploy/groups/g2/provision.json', root)));
  assert.equal(shared.identity_access, PINNED.identity);
  assert.equal(shared.club_domain, PINNED.g1);
  assert.equal(provision.canisters.club_domain, PINNED.g2);
});

test('rejects foreign, incomplete, substituted or unsettled journals', () => {
  validateJournal(journal(), binding);
  assert.throws(() => validateJournal(journal({ binding: { ...binding, governor: 'other' } }), binding));
  assert.throws(() => validateJournal(journal({ steps: journal().steps.slice(0, 2) }), binding));
  assert.throws(() => validateJournal(journal({ steps: journal().steps.map(s => s.groupId === 'g1' ? { ...s, newHash: 'e'.repeat(64) } : s) }), binding));
  assert.throws(() => validateJournal(journal({ complete: true, steps: journal().steps.map(s => ({ ...s, phase: 'pending' })) }), binding));
  assert.throws(() => validateJournal(journal({ steps: journal().steps.map(s => ({ ...s, oldHash: 'not-a-hash' })) }), binding));
});

test('historical fill never certifies readiness, even after both groups complete', () => {
  assert.throws(() => validateJournal(journal({ ready: true }), binding), /cannot certify/);
  assert.throws(() => validateJournal(journal({ ready: true, complete: false }), binding));
  assert.throws(() => validateJournal(journal({ ready: true, fill: { g1: true, g2: false } }), binding));
  assert.throws(() => validateJournal(journal({ fill: { g1: 'yes', g2: true } }), binding));
});

test('fill uses each exact source and persists only its acknowledged revision', async () => {
  const left = { g1: 3, g2: 1 }; let flaky = true;
  const persisted = [];
  const done = await runFill(['g1', 'g2'], async g => {
    if (g === 'g2' && flaky) { flaky = false; throw new Error('timeout'); }
    left[g]--; return { Ok: { source: g, revision: g === 'g1' ? 7n : 11n, scanned: 100n, phase: left[g] <= 0 ? 'acknowledged' : 'materialize' } };
  }, { persist: async (g, revision) => { persisted.push([g, revision]); } });
  assert.deepEqual(done, { g1: 7n, g2: 11n });
  assert.deepEqual(persisted, [['g1', 7n], ['g2', 11n]]);
});

test('fill stops on refusal and never loops forever', async () => {
  await assert.rejects(() => runFill(['g1'], async () => ({ Err: 'Governor required' })), /refused/);
  await assert.rejects(() => runFill(['g1'], async () => ({ Ok: { source: 'g1', revision: 1n, scanned: 0n, phase: 'published' } }), { maxCalls: 3 }), /did not finish/);
});

test('upgrade is blocked before live mutation until release acceptance exists', () => {
  assert.throws(requireLookupReleaseAcceptance, /No canisters changed/);
});

test('fill rejects wrong sources, fabricated completion, malformed and unbounded progress', async () => {
  const valid = { source: 'g1', revision: 1n, scanned: 0n, phase: 'acknowledged' };
  for (const progress of [{ ...valid, source: 'g2' }, { scanned: 0n, complete: true }, { ...valid, revision: 0n }, { ...valid, scanned: 101n }, { ...valid, scanned: -1n }, { ...valid, phase: 'complete' }, { ...valid, revision: 1 }]) {
    let persisted = false;
    await assert.rejects(() => runFill(['g1'], async () => ({ Ok: progress }), { persist: async () => { persisted = true; } }), /Invalid membership progress/);
    assert.equal(persisted, false);
  }
  await assert.rejects(() => runFill(['g1'], async () => null), /Invalid membership progress/);
  await assert.rejects(() => runFill(['g1', 'g1'], async () => ({ Ok: valid })), /source list/);
  await assert.rejects(() => runFill(['g3'], async () => ({ Ok: valid })), /source list/);
});

test('unknown replies exhaust retries and failed persistence stops the next source', async () => {
  let attempts = 0;
  await assert.rejects(() => runFill(['g1'], async () => { attempts++; throw new Error('timeout'); }, { retries: 2 }), /timeout/);
  assert.equal(attempts, 3);
  const called = [];
  await assert.rejects(() => runFill(['g1', 'g2'], async g => {
    called.push(g); return { Ok: { source: g, revision: 1n, scanned: 0n, phase: 'acknowledged' } };
  }, { persist: async () => { throw new Error('readback failed'); } }), /readback failed/);
  assert.deepEqual(called, ['g1']);
});

test('journal binding digest covers the exact target set', () => {
  const other = { ...binding, targets: targets.map(t => ({ ...t, newHash: 'f'.repeat(64) })) };
  assert.notEqual(digest(binding), digest(other));
});
