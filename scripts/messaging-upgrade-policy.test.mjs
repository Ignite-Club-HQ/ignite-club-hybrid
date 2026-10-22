import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, validateTargets, executeUpgrades } from './messaging-upgrade-policy.mjs';
const targets = ['mx3u5-iqaaa-aaaal-qxlqq-cai', 'yluv5-wiaaa-aaaal-qxpzq-cai'].map((canisterId, i) => ({ canisterId, groupId: `g${i + 1}`, name: 'messaging_domain', subnetId: 'subnet', newHash: 'b'.repeat(64) }));
test('requires explicit chat-only approval and exact two distinct messaging canisters', () => {
  validateRequest('upgrade', ' UPGRADE BOTH GROUPS CHATS\n'); validateTargets(targets);
  assert.throws(() => validateRequest('upgrade', 'UPGRADE BOTH GROUPS SUBSCRIPTIONS'));
  assert.throws(() => validateTargets([...targets, targets[0]]));
  assert.throws(() => validateTargets(targets.map(t => ({ ...t, name: 'club_domain' }))));
  assert.throws(() => validateTargets([targets[1], targets[1]]));
});
test('unknown upgrade stays pending; exact live candidate readback resumes without reinstall', async () => {
  const journal = { complete: false, steps: targets.map(t => ({ ...t, oldHash: 'a'.repeat(64), settingsHash: 'c'.repeat(64), phase: 'ready' })) };
  const live = new Map(targets.map(t => [t.canisterId, 'a'.repeat(64)]));
  let installs = 0, persisted = 0;
  const transport = { gate: async () => {}, verifyKeys: async () => {}, persist: async () => { persisted++; },
    observe: async s => ({ moduleHash: live.get(s.canisterId), settingsHash: 'c'.repeat(64) }),
    install: async s => { assert.ok(persisted > 0); installs++; live.set(s.canisterId, s.newHash); if (installs === 1) throw new Error('lost reply'); } };
  await assert.rejects(() => executeUpgrades(journal, transport), /lost reply/);
  assert.equal(journal.steps[0].phase, 'pending');
  await executeUpgrades(journal, transport);
  assert.equal(installs, 2); assert.equal(journal.complete, true);
});