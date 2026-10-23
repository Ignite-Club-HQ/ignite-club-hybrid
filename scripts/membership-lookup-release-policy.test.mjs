import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRequest, validateTargets, validateJournal, runFill, digest, PINNED } from './membership-lookup-release-policy.mjs';

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

test('readiness is never recorded before upgrades and fill complete', () => {
  validateJournal(journal({ ready: true }), binding);
  assert.throws(() => validateJournal(journal({ ready: true, complete: false }), binding));
  assert.throws(() => validateJournal(journal({ ready: true, fill: { g1: true, g2: false } }), binding));
  assert.throws(() => validateJournal(journal({ fill: { g1: 'yes', g2: true } }), binding));
});

test('fill resumes across transient failures until both groups report complete', async () => {
  const left = { g1: 3, g2: 1 }; let flaky = true;
  const done = await runFill(['g1', 'g2'], async g => {
    if (g === 'g2' && flaky) { flaky = false; throw new Error('timeout'); }
    left[g]--; return { Ok: { scanned: 100, complete: left[g] <= 0 } };
  });
  assert.deepEqual(done, { g1: true, g2: true });
});

test('fill stops on refusal and never loops forever', async () => {
  await assert.rejects(() => runFill(['g1'], async () => ({ Err: 'Governor required' })), /refused/);
  await assert.rejects(() => runFill(['g1'], async () => ({ Ok: { scanned: 0, complete: false } }), { maxCalls: 3 }), /did not finish/);
});

test('journal binding digest covers the exact target set', () => {
  const other = { ...binding, targets: targets.map(t => ({ ...t, newHash: 'f'.repeat(64) })) };
  assert.notEqual(digest(binding), digest(other));
});
