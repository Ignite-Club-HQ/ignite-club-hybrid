// Disposable consensus canisters only. Never uses a production identity.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const app = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const browser = Principal.fromUint8Array(Uint8Array.from([3, 1]));
const outsider = Principal.fromUint8Array(Uint8Array.from([4, 1]));
const ok = r => { assert.ok('Ok' in r, JSON.stringify(r, (_, v) => typeof v === 'bigint' ? String(v) : v)); return r.Ok; };
const refused = async call => { let failed = false; try { const r = await call(); failed = !!r && 'Err' in r; } catch (e) { assert.match(String(e), /Account admission denied|Linked account authority unavailable|Account removal fenced/); failed = true; } assert.equal(failed, true); };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: process.env.IDENTITY_ACCESS_WASM, sender: governor, controllers: [governor], environmentVariables: [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }], arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  identity.actor.setPrincipal(governor); ok(await identity.actor.register_account());
  const groups = [];
  for (const name of ['giddy-goat', 'group-2-test']) {
    const group = await pic.setupCanister({ idlFactory: clubIdl, wasm: process.env.CLUB_DOMAIN_WASM, sender: governor, controllers: [governor], environmentVariables: [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }, { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: identity.canisterId.toText() }], arg: IDL.encode([IDL.Principal], [governor]) });
    groups.push({ ...group, name });
    identity.actor.setPrincipal(governor); ok(await identity.actor.set_service_authorities(groups.map(g => g.canisterId)));
    group.actor.setPrincipal(governor); ok(await group.actor.create_club(name, name, name, [], []));
    ok(await group.actor.add_role_grant(app, name, 'club_admin', []));
    ok(await group.actor.add_role_grant(app, name, 'team_admin', ['u9']));
    const team = { id: 'u9', club_id: name, name: 'U9', archived: false, is_active: true, is_shell: false, playhq_auto_create_events: false };
    for (const key of ['age_group', 'deleted_at_ms', 'description', 'division', 'folder_id', 'gender', 'logo_url', 'playhq_competition_id', 'playhq_team_id', 'shell_claim_token', 'shell_claimed_at_ms', 'shell_claimed_by', 'shell_contact_email', 'shell_contact_name', 'shell_invited_by', 'team_type']) team[key] = [];
    ok(await group.actor.save_team(team));
  }
  identity.actor.setPrincipal(governor); ok(await identity.actor.set_club_authorities(groups.map(g => g.canisterId)));
  for (const group of groups) { group.actor.setPrincipal(governor); ok(await group.actor.set_identity_access_canister(identity.canisterId)); }
  identity.actor.setPrincipal(app); const account = ok(await identity.actor.register_account());
  const challenge = ok(await identity.actor.begin_link(browser)); identity.actor.setPrincipal(browser); ok(await identity.actor.accept_link(challenge.id));
  identity.actor.setPrincipal(outsider); ok(await identity.actor.register_account());
  for (const group of groups) {
    // No sync/role copy: browser discovers existing app grants immediately.
    group.actor.setPrincipal(browser);
    assert.deepEqual(ok(await group.actor.read_my_club_memberships_indexed([], 100)).clubs, [group.name]);
    const roles = await group.actor.read_account_my_role_grants();
    assert.deepEqual(roles.map(r => [r.role, r.club[0], r.team[0] ?? null]), [['club_admin', group.name, null], ['team_admin', group.name, 'u9']]);
    assert.equal(roles.every(r => r.user.toText() === app.toText()), true, 'stored owners unchanged');
    assert.equal(await group.actor.read_account_is_club_member(browser, group.name), true);
    assert.equal(await group.actor.read_account_is_club_member(browser, 'unrelated-club'), false);
    ok(await group.actor.read_account_get_club_roster(group.name));
    ok(await group.actor.set_club_kind(group.name, 'club'));
    ok(await group.actor.set_team_welcome_email('u9', true, 'Welcome', 'Test'));
    await refused(() => group.actor.set_team_welcome_email('unrelated-team', true, 'Welcome', 'Test'));
    group.actor.setPrincipal(outsider);
    assert.deepEqual(await group.actor.read_account_my_role_grants(), []);
    await refused(() => group.actor.read_account_get_club_roster(group.name));
  }
  identity.actor.setPrincipal(governor); ok(await identity.actor.set_account_status(account.id, { Suspended: null }));
  groups[0].actor.setPrincipal(browser); await refused(() => groups[0].actor.read_account_my_role_grants());
  identity.actor.setPrincipal(governor); ok(await identity.actor.set_account_status(account.id, { Active: null }));
  // Club removal on either alias denies the whole account only in that club.
  groups[0].actor.setPrincipal(governor); ok(await groups[0].actor.remove_member(groups[0].name, app));
  groups[0].actor.setPrincipal(browser); assert.deepEqual(await groups[0].actor.read_account_my_role_grants(), []);
  assert.equal(await groups[0].actor.read_account_is_club_member(browser, groups[0].name), false);
  groups[1].actor.setPrincipal(browser); assert.equal((await groups[1].actor.read_account_my_role_grants()).length, 2);
  await pic.stopCanister({ canisterId: identity.canisterId, sender: governor });
  await refused(() => groups[1].actor.read_account_my_role_grants());
  await pic.startCanister({ canisterId: identity.canisterId, sender: governor });
  identity.actor.setPrincipal(app); ok(await identity.actor.revoke(browser, 1n));
  await refused(() => groups[1].actor.read_account_my_role_grants());
  console.log('PASS: real two-group linked discovery/rosters, stored owners preserved, unrelated caller/club denial, suspension, club-only removal and unlink denial.');
} finally { await pic?.tearDown(); await server.stop(); }