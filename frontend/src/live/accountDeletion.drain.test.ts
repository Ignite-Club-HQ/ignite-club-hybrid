// Evidence-only local drain proof. Production routing/admission remain off.
// Real identity/club/vault/events/messaging/media contracts; connector seams only.
// Proves that after a full admin account deletion, the erased principal is denied
// by every service that delegates authorization to club_domain (fail-closed).
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';
import { idlFactory as clubIdl } from '../lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as identityIdl } from '../lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as vaultIdl } from '../lab/bindings/vault_domain/declarations/vault_domain.did.js';
import { idlFactory as eventsIdl } from '../lab/bindings/events_domain/declarations/events_domain.did.js';
import { idlFactory as messagingIdl } from '../lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as mediaIdl } from '../lab/bindings/media_blob_store/declarations/media_blob_store.did.js';

const seam = vi.hoisted(() => ({ connect: undefined as any, identity: undefined as any }));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: false }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => false, generalRoutingStatus: async () => ({ active: false, missing: [] }), cachedGeneralRoutingActive: () => false, clearGeneralRoutingCache: () => {} }));
vi.mock('./identityAccess', () => ({
  connectLiveIdentityAccessClientWithIdentity: (...args: any[]) => seam.identity(...args),
}));
vi.mock('./domains', () => ({ connectLiveClubDomain: (...args: any[]) => seam.connect(...args) }));
import { eraseIcpAccountAsAdmin } from './adminAccountDeletion';

const enabled = Boolean(process.env.IDENTITY_ACCESS_WASM && process.env.CLUB_DOMAIN_WASM
  && process.env.VAULT_DOMAIN_WASM && process.env.EVENTS_DOMAIN_WASM
  && process.env.MESSAGING_DOMAIN_WASM && process.env.MEDIA_BLOB_STORE_WASM
  && process.env.POCKET_IC_BIN);
const p = (n: number) => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1);
const member = p(2);
const ok = (r: any) => { expect(r.Err).toBeUndefined(); expect('Ok' in r).toBe(true); return r.Ok; };
const denied = (r: any) => { expect(r.Ok).toBeUndefined(); expect(typeof r.Err).toBe('string'); };
let server: PocketIcServer;
let pic: PocketIc;

describe.skipIf(!enabled)('account deletion all-service drain (real contracts)', () => {
  beforeAll(async () => { server = await PocketIcServer.start(); pic = await PocketIc.create(server.getUrl()); }, 60000);
  afterAll(async () => { await pic?.tearDown(); await server?.stop(); }, 60000);

  it('erased principal is denied in vault, events, messaging and media after admin deletion', async () => {
    const govArg = IDL.encode([IDL.Principal], [governor]);
    const setup = (idlFactory: any, wasm: string, withArg = true) =>
      pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], ...(withArg ? { arg: govArg } : {}) });
    const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: process.env.IDENTITY_ACCESS_WASM!,
      sender: governor, controllers: [governor],
      environmentVariables: [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }],
      arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
    const club = await setup(clubIdl, process.env.CLUB_DOMAIN_WASM!);
    const vault = await setup(vaultIdl, process.env.VAULT_DOMAIN_WASM!);
    const events = setup(eventsIdl, process.env.EVENTS_DOMAIN_WASM!);
    const messaging = await setup(messagingIdl, process.env.MESSAGING_DOMAIN_WASM!);
    const media = await pic.setupCanister({ idlFactory: mediaIdl, wasm: process.env.MEDIA_BLOB_STORE_WASM!, sender: governor, controllers: [governor],
      environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }] });

    // Wire every service's club authorization source to the real club canister.
    for (const c of [vault, await events, messaging, media]) {
      c.actor.setPrincipal(governor);
      ok(await c.actor.set_club_domain_canister(club.canisterId));
    }

    club.actor.setPrincipal(governor);
    ok(await club.actor.create_club('c1', 'c1', 'c1', [], []));
    ok(await club.actor.add_role_grant(member, 'c1', 'player', []));
    ok(await club.actor.add_role_grant(member, 'c1', 'club_admin', []));
    identity.actor.setPrincipal(governor); ok(await identity.actor.register_account());
    identity.actor.setPrincipal(member); const account = ok(await identity.actor.register_account());
    // Setter-only local wiring: transient rehearsal flag, removed before all calls.
    await pic.updateCanisterSettings({ canisterId: club.canisterId, sender: governor,
      environmentVariables: [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }] });
    club.actor.setPrincipal(governor);
    ok(await club.actor.set_identity_access_canister(identity.canisterId));
    identity.actor.setPrincipal(governor);
    ok(await identity.actor.set_club_authorities([club.canisterId]));
    club.actor.setPrincipal(member); ok(await club.actor.sync_my_linked_account());
    await pic.updateCanisterSettings({ canisterId: club.canisterId, sender: governor, environmentVariables: [] });

    // Pre-deletion: the member can act in every service.
    vault.actor.setPrincipal(member);
    ok(await vault.actor.create_folder('f1', 'c1', [], [], 'Folder', [], [], [], 0, [], []));
    (await events).actor.setPrincipal(member);
    ok(await (await events).actor.create_event('c1', [], 'Training', 'Weekly session', 'training', [], [], [], [], BigInt(Date.now() + 3_600_000), BigInt(Date.now() + 7_200_000), [], false, [], []));
    messaging.actor.setPrincipal(governor);
    const conversation = ok(await messaging.actor.create_conversation('c1', [], [governor, member]));
    messaging.actor.setPrincipal(member);
    ok(await messaging.actor.send_message(conversation.id, 'hello', 'k1', [], []));
    media.actor.setPrincipal(member);
    ok(await media.actor.begin_upload('clubs/c1/photo.jpg', 'image/jpeg', 10n, 1));

    // Full admin deletion through the real entrypoint (ungrouped path).
    const target = { canisterIds: { club_domain: club.canisterId.toText(), identity_access: identity.canisterId.toText() } } as IcpTargetConfig;
    seam.identity = async () => ({ client: {
      eraseAccount: async (accountId: string) => { identity.actor.setPrincipal(governor); ok(await identity.actor.erase_account(accountId)); },
      dispose: () => {},
    } });
    seam.connect = async () => ({ actor: { erase_account_membership: async (accountId: string) => {
      club.actor.setPrincipal(governor); return club.actor.erase_account_membership(accountId);
    } } });
    await eraseIcpAccountAsAdmin({ getPrincipal: () => governor } as Identity, target, account.id);

    // Post-deletion: every service denies the erased principal.
    club.actor.setPrincipal(governor);
    const grants = ok(await club.actor.list_role_grants('c1'));
    expect(grants.some((g: any) => g.account_id === account.id)).toBe(false);
    vault.actor.setPrincipal(member);
    denied(await vault.actor.create_folder('f2', 'c1', [], [], 'Folder', [], [], [], 0, [], []));
    (await events).actor.setPrincipal(member);
    denied(await (await events).actor.create_event('c1', [], 'Training', 'Weekly session', 'training', [], [], [], [], BigInt(Date.now() + 3_600_000), BigInt(Date.now() + 7_200_000), [], false, [], []));
    messaging.actor.setPrincipal(member);
    // Messaging denies removed members with a trap (reject) rather than an Err variant.
    await expect(messaging.actor.send_message(conversation.id, 'still here?', 'k2', [], [])).rejects.toThrow();
    media.actor.setPrincipal(member);
    // Media denies with a reject ("Club membership required for upload").
    await expect(media.actor.begin_upload('clubs/c1/more.jpg', 'image/jpeg', 10n, 1)).rejects.toThrow('Club membership required');
    identity.actor.setPrincipal(member);
    expect(await identity.actor.register_account()).toHaveProperty('Err');
  }, 120000);
});
