import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTargets } from './messaging-upgrade-policy.mjs';
test('actual repository mappings bind Group 1 legacy and Group 2 to different chat canisters', () => {
  const root = new URL('../', import.meta.url);
  const shared = JSON.parse(readFileSync(new URL('deploy/mainnet/.icp/data/mappings/ic.ids.json', root)));
  const provision = JSON.parse(readFileSync(new URL('deploy/groups/g2/provision.json', root)));
  validateTargets([{ groupId: 'g1', name: 'messaging_domain', canisterId: shared.messaging_domain, subnetId: 'subnet', newHash: 'a'.repeat(64) },
    { groupId: 'g2', name: 'messaging_domain', canisterId: provision.canisters.messaging_domain, subnetId: 'subnet', newHash: 'a'.repeat(64) }]);
});