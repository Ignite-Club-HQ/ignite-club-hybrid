import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';
import { idlFactory } from '../src/lab/bindings/placement_registry/declarations/placement_registry.did.js';

const root = new URL('../../', import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL('.local-icp/public.json', root), 'utf8'));
const mapping = JSON.parse(fs.readFileSync(new URL('.icp/cache/mappings/local.ids.json', root), 'utf8'));
const canisterId = mapping.placement_registry;
if (!canisterId || !config.rootKey) throw new Error('Requires a deployed loopback placement_registry');
const rootKey = Uint8Array.from(config.rootKey.match(/../g), value => parseInt(value, 16));
const host = config.apiUrl ?? 'http://127.0.0.1:4943/';
async function actorFor(persona) {
  const agent = await HttpAgent.create({ host, identity: syntheticIdentity(persona), rootKey, shouldFetchRootKey: false, shouldSyncTime: false });
  return Actor.createActor(idlFactory, { agent, canisterId });
}
const governor = await actorFor('governor');
const appAdmin = await actorFor('app_admin');
const outsider = await actorFor('outsider');
const ok = (result, label) => { if ('Err' in result) throw new Error(`${label}: ${result.Err}`); return result.Ok; };
const rejected = async (promise, label) => { const result = await promise; assert('Err' in result, `${label} should be rejected`); };
const suffix = Date.now().toString(36);

const initialPolicy = ok(await governor.get_policy('SG'), 'read SG policy');
await rejected(outsider.set_policy('SG', true, true, initialPolicy.version), 'outsider policy update');

ok(await governor.grant_operator(syntheticIdentity('app_admin').getPrincipal(), [{ SecurityAdmin: null }, { InfrastructureAdmin: null }, { PlacementAdmin: null }]), 'grant app-admin placement roles');
const policy = ok(await appAdmin.set_policy('SG', false, true, initialPolicy.version), 'app-admin country policy');
assert.equal(policy.icp_enabled, true);
assert.equal(policy.supabase_enabled, false);

let version = await governor.version();
const target = ok(await appAdmin.set_target(`icp-singapore-${suffix}`, ['site-c'], 'SG_SINGAPORE', { Icp: { canister: Principal.fromText(canisterId) } }, 'cloud_engine', true, version), 'app-admin target version');
version = await governor.version();
const currentResidencyPolicy = ok(await appAdmin.get_residency_policy('SG'), 'read SG residency policy');
const residencyPolicy = ok(await appAdmin.set_residency_policy('SG', ['SG_SINGAPORE'], currentResidencyPolicy.version), 'app-admin residency policy');
assert.deepEqual(residencyPolicy.allowed_profiles, ['SG_SINGAPORE']);

const club = `club-admin-${suffix}`;
version = await governor.version();
const placement = ok(await appAdmin.set_placement(club, 'SG', { Icp: { canister: Principal.fromText(canisterId) } }, version), 'country-approved club placement');
assert.equal(placement.country, 'SG');
version = await governor.version();
ok(await appAdmin.set_residency(club, 'SG_SINGAPORE', target.alias, version), 'country-approved residency');

const supabaseDenied = await appAdmin.set_placement(`club-denied-${suffix}`, 'SG', { Supabase: { environment: 'site-c-supabase' } }, await governor.version());
assert('Err' in supabaseDenied, 'country-disallowed Supabase assignment should fail');
assert.match(supabaseDenied.Err, /disallowed|disabled/i);

const decision = ok(await governor.get_decision(club), 'read approved decision')[0];
assert.equal(decision.writable, true);
console.log(JSON.stringify({ status: 'PASS', canisterId, target: target.alias, club, country: placement.country, deniedReason: supabaseDenied.Err, checks: ['outsider denied', 'app-admin operator role', 'country policy', 'target/version', 'residency', 'country-constrained assignment', 'live writable decision'] }, null, 2));
