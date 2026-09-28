import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';

const root = new URL('../../', import.meta.url);
const configPath = process.env.IDENTITY_BOOTSTRAP_CONFIG ?? '.local-icp/public.json';
const config = JSON.parse(fs.readFileSync(new URL(configPath, root), 'utf8'));
const mapping = config.identity_access || config.identity || config.identityAccessCanisterId
  ? config
  : JSON.parse(fs.readFileSync(new URL('.icp/cache/mappings/local.ids.json', root), 'utf8'));
const identityCanister = mapping.identityAccessCanisterId ?? mapping.identity_access ?? mapping.identity;
const clubCanister = mapping.canisterId ?? mapping.club;
if (!identityCanister || !clubCanister || !config.rootKey) throw new Error('Requires an owned loopback identity/access deployment');
const rootKey = Uint8Array.from(config.rootKey.match(/../g), value => parseInt(value, 16));
const host = config.apiUrl ?? 'http://127.0.0.1:4943/';
async function actor(persona) {
  const agent = await HttpAgent.create({ host, identity: syntheticIdentity(persona), rootKey, shouldFetchRootKey: false, shouldSyncTime: false });
  return Actor.createActor(idlFactory, { agent, canisterId: identityCanister });
}
const governor = await actor('governor');
const account = (await governor.whoami()).Ok;
assert(account?.id, 'governor account must exist');
const suffix = Date.now().toString(36);
const club = `synthetic-club-${suffix}`;
const team = `synthetic-team-${suffix}`;
const denied = result => assert('Err' in result, 'expected rejection');
const before = (await governor.access([club], [team], [] )).Ok;
assert.equal(before.club_admin, false);
await governor.grant_role(account.id, 'club_admin', [club], []);
const after = (await governor.access([club], [team], [])).Ok;
assert.equal(after.club_admin, true);
const target = syntheticIdentity('identity-link-target').getPrincipal();
const challenge = (await governor.begin_link(target)).Ok;
const linked = await actor('identity-link-target');
assert.equal((await linked.accept_link(challenge.id)).Ok.id, account.id);
const linkedAccess = (await linked.access([club], [], [])).Ok;
assert.equal(linkedAccess.club_admin, true);
const revoked = await governor.revoke(target, account.version + 1n);
assert.equal(revoked.Ok.principals.length, 1);
denied(await linked.whoami());
denied(await (await actor('anonymous')).whoami());

// Step 4 Enhancements Verification: Multi-Site Scoped Roles, External Site Bindings, Privacy Consent
console.log('--- Testing Step 4 Enhancements: Federated Sites & Privacy Policy ---');

// 1. Multi-site role scoping
const siteA = 'site-a';
const siteB = 'site-b';
const multiSiteClub = 'multi-site-club-1';
const siteARole = await governor.grant_role_scoped(account.id, 'club_admin', [siteA], [multiSiteClub], []);
assert('Ok' in siteARole, `site A role grant failed: ${'Err' in siteARole ? siteARole.Err : 'unknown error'}`);

const accessSiteA = (await governor.access_scoped([siteA], [multiSiteClub], [], [])).Ok;
assert.equal(accessSiteA.club_admin, true, 'Should be club_admin on site A');

const accessSiteB = (await governor.access_scoped([siteB], [multiSiteClub], [], [])).Ok;
assert.equal(accessSiteB.club_admin, false, 'Should NOT be club_admin on site B without site B grant');

// 2. Multi-site exclusions
const siteBRole = await governor.grant_role_scoped(account.id, 'club_admin', [siteB], [multiSiteClub], []);
assert('Ok' in siteBRole, `site B role grant failed: ${'Err' in siteBRole ? siteBRole.Err : 'unknown error'}`);
const accessSiteBBeforeExclusion = (await governor.access_scoped([siteB], [multiSiteClub], [], [])).Ok;
assert.equal(accessSiteBBeforeExclusion.club_admin, true, 'Should be club_admin on site B after grant');

await governor.set_exclusion_scoped(account.id, [siteB], multiSiteClub, []);
const accessSiteBExcluded = (await governor.access_scoped([siteB], [multiSiteClub], [], [])).Ok;
assert.equal(accessSiteBExcluded.club_admin, false, 'Should be excluded on site B');

const accessSiteAStillActive = (await governor.access_scoped([siteA], [multiSiteClub], [], [])).Ok;
assert.equal(accessSiteAStillActive.club_admin, true, 'Site A access should remain unaffected by site B exclusion');

const guardianChild = `guardian-child-${suffix}`;
await governor.set_family(account.id, guardianChild);
const guardianAccessBeforeExclusion = (await governor.access_scoped([siteA], [multiSiteClub], [], [guardianChild])).Ok;
assert.equal(guardianAccessBeforeExclusion.guardian, true, 'Guardian link should be active before exclusion');
await governor.set_exclusion_scoped(account.id, [siteA], multiSiteClub, []);
const guardianAccessAfterExclusion = (await governor.access_scoped([siteA], [multiSiteClub], [], [guardianChild])).Ok;
assert.equal(guardianAccessAfterExclusion.guardian, false, 'Excluded guardian should lose guardian access in the same club scope');

// 3. External Supabase site user ID bindings
const externalBindingA = (await governor.bind_external_site(account.id, siteA, 'supabase-user-uuid-site-a-123')).Ok;
assert.equal(externalBindingA.site_id, siteA);
assert.equal(externalBindingA.external_user_id, 'supabase-user-uuid-site-a-123');

const externalBindingB = (await governor.bind_external_site(account.id, siteB, 'supabase-user-uuid-site-b-456')).Ok;
assert.equal(externalBindingB.site_id, siteB);
assert.equal(externalBindingB.external_user_id, 'supabase-user-uuid-site-b-456');

const bindings = (await governor.get_external_bindings(account.id)).Ok;
assert.equal(bindings.length, 2, 'Should have 2 external site bindings');

// 4. Privacy consent management
const consentPurpose = 'child_photo_processing';
assert.equal((await governor.get_privacy_consent(account.id, consentPurpose)).Ok, false, 'Consent should be false initially');

const consentGranted = (await governor.set_privacy_consent(account.id, consentPurpose, true)).Ok;
assert.equal(consentGranted.granted, true);
assert.equal((await governor.get_privacy_consent(account.id, consentPurpose)).Ok, true, 'Consent should be true after grant');

const consentRevoked = (await governor.set_privacy_consent(account.id, consentPurpose, false)).Ok;
assert.equal(consentRevoked.granted, false);
assert.equal((await governor.get_privacy_consent(account.id, consentPurpose)).Ok, false, 'Consent should be false after revocation');

// Account erasure must remove every owned record while preserving the governor account.
const eraseActor = await actor('other_admin');
const eraseAccount = (await eraseActor.register_account()).Ok;
assert(eraseAccount?.id && eraseAccount.id !== account.id, 'registration must create an independent account');
await governor.grant_role(eraseAccount.id, 'club_admin', [club], []);
await governor.set_family(eraseAccount.id, `erase-child-${suffix}`);
await governor.set_exclusion_scoped(eraseAccount.id, [siteA], multiSiteClub, []);
await governor.bind_external_site(eraseAccount.id, siteA, `erase-external-${suffix}`);
await eraseActor.set_privacy_consent(eraseAccount.id, 'profile', true);
const eraseChallenge = await eraseActor.begin_link(syntheticIdentity('outsider').getPrincipal());
assert('Ok' in eraseChallenge, 'erasure account should own a pending link challenge');
assert('Ok' in await eraseActor.erase_account(eraseAccount.id), 'account owner should erase its account');
denied(await eraseActor.whoami());
assert('Err' in await governor.erase_account(account.id), 'governor account erasure must fail closed');
assert.deepEqual((await governor.get_external_bindings(eraseAccount.id)).Ok, [], 'erasure must remove external bindings');

console.log('PASS: identity account registration, scoped role, multi-site isolation, external bindings, privacy consent, linked principal, revocation, erasure, and anonymous rejection.');
