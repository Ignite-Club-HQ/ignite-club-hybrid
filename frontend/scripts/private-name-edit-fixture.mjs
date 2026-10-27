// Disposable PocketIC only. Synthetic registry locations never reach a network.
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as messagingIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';

export async function createNameEditFixture({ clubDisplayReleaseOnly = false } = {}) {
  const root = resolve(import.meta.dirname, '../..');
  const principal = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
  const governor = principal(1), owner = principal(3), viewer = principal(2), outsider = principal(4);
  const ok = result => { if ('Err' in result) throw Error(result.Err); return result.Ok; };
  const server = await PocketIcServer.start();
  let pic;
  try {
    pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
    const arg = IDL.encode([IDL.Principal], [governor]);
    const rustArg = IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]);
    const privacy = { name: 'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL', value: '1' };
    const cleanup = { name: 'IGNITE_PRIVATE_NAME_CLEANUP_REHEARSAL', value: '1' };
    const rust = async (domain, idlFactory) => pic.setupCanister({ idlFactory, wasm: resolve(root, `target/wasm32-unknown-unknown/release/${domain}.wasm`), sender: governor, controllers: [governor], arg: rustArg, environmentVariables: [{ name: 'IGNITE_BOUND_DELETION_RELEASE', value: '1' }, { name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }] });
    const identity = await rust('identity_access', identityIdl), router = await rust('shard_router', routerIdl);
    const mo = async (domain, idlFactory, environmentVariables) => pic.setupCanister({ idlFactory, wasm: resolve(root, `backend/${domain}/.mops/.build/${domain}.wasm`), sender: governor, controllers: [governor], arg, environmentVariables });
    const club = await mo('club_domain', clubIdl, [privacy, { name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }]);
    club.actor.setPrincipal(governor); ok(await club.actor.set_identity_access_canister(identity.canisterId));
    await pic.updateCanisterSettings({ canisterId: club.canisterId, sender: governor, environmentVariables: [privacy, cleanup] });
    await pic.upgradeCanister({ canisterId: club.canisterId, wasm: resolve(root, 'backend/club_domain/.mops/.build/club_domain.wasm'), sender: governor, arg, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    const messaging = await mo('messaging_domain', messagingIdl, [privacy, { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: identity.canisterId.toText() }]);
    const pii = await mo('pii_access_control', piiIdl, [privacy, cleanup, { name: 'IGNITE_PRIVATE_PROFILE_IDENTITY', value: identity.canisterId.toText() }, { name: 'VETKD_KEY_NAME', value: 'key_1' }]);
    const clubId = 'name-edit-club';
    ok(await club.actor.create_club(clubId, 'Acceptance Club', 'acceptance', [], []));
    ok(await club.actor.replace_acl(1n, { clubs: [clubId], teams: [], children: [], guardians: [], exclusions: [], roles: [owner, viewer].map(user => ({ user, role: 'member', club: [clubId], team: [] })) }));
    for (const user of [owner, viewer, outsider]) { identity.actor.setPrincipal(user); ok(await identity.actor.register_account()); }
    const subnet = await pic.getCanisterSubnetId(identity.canisterId);
    if (!subnet) throw Error('Missing disposable subnet');
    const domainNames = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain', 'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs', 'secret_workload_identity'];
    const services = { club_domain: club, pii_access_control: pii, messaging_domain: messaging, identity_access: identity, shard_router: router };
    const domains = domainNames.map((domain, index) => ({ domain, canister: services[domain]?.canisterId ?? principal(20 + index) }));
    router.actor.setPrincipal(governor);
    let revision = await router.actor.version();
    revision = ok(await router.actor.register_group({ id: 'g1', target_alias: 'mainnet', domains, photo_store: [], accepting: true, max_clubs: 100, assigned_clubs: 0, heap_budget_bytes: 1000000n, heap_bytes: 0n, min_cycles: 1n, cycles: 1n, observed_at_ns: BigInt(await pic.getTime()) * 1000000n }, revision));
    revision = ok(await router.actor.register_group_placement({ group_id: 'g1', deployment_id: 'mainnet', deployment_revision: 1n, host: 'https://icp-api.io', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet], additional_subnets_enabled: false, domains: domains.map(d => ({ ...d, subnet })) }, revision));
    ok(await router.actor.record_group_health('g1', 0n, 1000000n, revision));
    const assignment = ok(await router.actor.assign_new_club_group(clubId, 'mainnet', revision));
    revision = assignment.revision;
    const binding = { registry: router.canisterId, registry_revision: revision, target_alias: 'mainnet', deployment_id: 'mainnet', deployment_revision: 1n, host: 'https://icp-api.io', network_kind: 'public_mainnet' };
    identity.actor.setPrincipal(governor);
    ok(await identity.actor.pin_owner_test_deletion_registry(binding));
    ok(await identity.actor.set_service_authorities([pii.canisterId]));
    ok(await identity.actor.configure_membership_directory(binding, [club.canisterId], 1n));
    messaging.actor.setPrincipal(governor);
    ok(await messaging.actor.set_club_domain_canister(club.canisterId));
    const group = ok(await messaging.actor.create_group_with_roles(clubId, [], 'Acceptance chat', 'group', [[governor, 'owner'], [owner, 'member'], [viewer, 'member']]));
    messaging.actor.setPrincipal(owner);
    const message = ok(await messaging.actor.send_message(group.conversation_id, 'Name-edit acceptance message', 'name-edit-1', [], []));
    if (clubDisplayReleaseOnly) {
      const display = { name: 'IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE', value: '1' };
      const save = { name: 'IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE', value: '1' };
      await pic.updateCanisterSettings({canisterId:identity.canisterId,sender:governor,environmentVariables:[display,save,{name:'IGNITE_SECURE_ADULT_NAME_PII',value:pii.canisterId.toText()}]});
      await pic.updateCanisterSettings({canisterId:club.canisterId,sender:governor,environmentVariables:[display]});
      await pic.upgradeCanister({canisterId:club.canisterId,sender:governor,wasm:resolve(root,'backend/club_domain/.mops/.build/club_domain.wasm'),arg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
      await pic.updateCanisterSettings({canisterId:pii.canisterId,sender:governor,environmentVariables:[display,save,{name:'IGNITE_PRIVATE_PROFILE_IDENTITY',value:identity.canisterId.toText()},{name:'IGNITE_SECURE_ADULT_NAME_IDENTITY',value:identity.canisterId.toText()},{name:'VETKD_KEY_NAME',value:'key_1'}]});
      await pic.upgradeCanister({canisterId:pii.canisterId,sender:governor,wasm:resolve(root,'backend/pii_access_control/.mops/.build/pii_access_control.wasm'),arg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
      await pic.updateCanisterSettings({canisterId:messaging.canisterId,sender:governor,environmentVariables:[]});
      await pic.upgradeCanister({canisterId:messaging.canisterId,sender:governor,wasm:resolve(root,'backend/messaging_domain/.mops/.build/messaging_domain.wasm'),arg,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
    }
    const factories = { club_domain: clubIdl, pii_access_control: piiIdl, messaging_domain: messagingIdl, identity_access: identityIdl };
    const counters = { clubUnlocks: 0 };
    const connect = (domain, user) => {
      const service = services[domain];
      if (!service || !factories[domain]) throw Error('Unknown disposable service');
      const actor = pic.createActor(factories[domain], service.canisterId);
      actor.setPrincipal(user);
      if (domain === 'pii_access_control') {
        const derive = actor.get_private_profile_club_name_vetkey;
        actor.get_private_profile_club_name_vetkey = (...args) => { counters.clubUnlocks++; return derive(...args); };
      }
      return { actor, canisterId: service.canisterId };
    };
    return { pic, owner, viewer, outsider, governor, clubId, conversationId: group.conversation_id, message, services, connect, counters, ok, close: async () => { await pic.tearDown(); await server.stop(); } };
  } catch (error) { await pic?.tearDown(); await server.stop(); throw error; }
}