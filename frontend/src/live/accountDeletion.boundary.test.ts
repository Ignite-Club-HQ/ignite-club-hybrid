// Evidence-only local contract test. Production routing/admission remain off.
// Real identity/club canisters; connector and registry transport seams only.
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';
import { idlFactory as clubIdl } from '../lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as identityIdl } from '../lab/bindings/identity_access/declarations/identity_access.did.js';

const seam = vi.hoisted(() => ({ connect: undefined as any, identity: undefined as any,
  session: undefined as any, purges: [] as string[] }));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: true }) }));
vi.mock('./identityAccess', () => ({ isLiveIdentityAccessConfigured: () => true,
  connectLiveIdentityAccessClientWithIdentity: (...args: any[]) => seam.identity(...args) }));
vi.mock('./groupSessionLive', () => ({ openLiveGroupReadSession: (...args: any[]) => seam.session(...args) }));
vi.mock('./domains', () => {
  const purge = (name: string) => async () => ({ actor: { purge_my_data: async () => {
    seam.purges.push(name); return { Ok: 0 };
  } } });
  return { connectLiveClubDomain: (...args: any[]) => seam.connect(...args),
    connectLiveVaultDomain: purge('vault'), connectLiveEventsDomain: purge('events'),
    connectLiveMessagingDomain: purge('messaging') };
});
import { eraseMyIcpAccount } from './accountData';
import { eraseIcpAccountAsAdmin } from './adminAccountDeletion';
import { openGroupSession, type GroupRegistry } from './groupSession';
import { GROUP_DOMAINS } from './groupRouting';

const enabled = Boolean(process.env.IDENTITY_ACCESS_WASM && process.env.CLUB_DOMAIN_WASM && process.env.POCKET_IC_BIN);
const p = (n: number) => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1);
const ok = (r: any) => { expect(r.Err).toBeUndefined(); expect('Ok' in r).toBe(true); return r.Ok; };
let server: PocketIcServer;
let pic: PocketIc;
let sequence = 10;

describe.skipIf(!enabled)('local deletion activation boundary (real club/identity contracts)', () => {
  beforeAll(async () => { server = await PocketIcServer.start(); pic = await PocketIc.create(server.getUrl()); }, 60000);
  afterAll(async () => { await pic?.tearDown(); await server?.stop(); });

  async function fixture() {
    const primary = p(sequence++), linked = p(sequence++);
    const env = [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }];
    const shared = await pic.setupCanister({ idlFactory: identityIdl, wasm: process.env.IDENTITY_ACCESS_WASM,
      sender: governor, controllers: [governor], environmentVariables: env,
      arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
    const clubs = [];
    for (const name of ['legacy', 'new']) {
      const c = await pic.setupCanister({ idlFactory: clubIdl, wasm: process.env.CLUB_DOMAIN_WASM,
        sender: governor, controllers: [governor],
        arg: IDL.encode([IDL.Principal], [governor]) });
      c.actor.setPrincipal(governor);
      ok(await c.actor.create_club(name, name, name, [], []));
      ok(await c.actor.add_role_grant(primary, name, 'player', []));
      ok(await c.actor.add_role_grant(linked, name, 'coach', []));
      // Setter-only local wiring: transient admission stays OFF because these
      // services were installed without the flag. Remove it before all calls.
      await pic.updateCanisterSettings({ canisterId: c.canisterId, sender: governor, environmentVariables: env });
      ok(await c.actor.set_identity_access_canister(shared.canisterId));
      await pic.updateCanisterSettings({ canisterId: c.canisterId, sender: governor, environmentVariables: [] });
      clubs.push(c);
    }
    const id = shared.actor;
    id.setPrincipal(governor); ok(await id.register_account());
    ok(await id.set_club_authorities(clubs.map(c => c.canisterId)));
    id.setPrincipal(primary); const account = ok(await id.register_account());
    const challenge = ok(await id.begin_link(linked));
    id.setPrincipal(linked); ok(await id.accept_link(challenge.id));
    for (const c of clubs) { c.actor.setPrincipal(linked); ok(await c.actor.sync_my_linked_account()); }
    const targets = clubs.map((c, i) => ({ alias: 'mainnet', provider: 'icp', deploymentClass: 'public_subnet',
      host: 'https://icp-api.io', networkKind: 'public_mainnet',
      canisterIds: Object.fromEntries([...GROUP_DOMAINS.map(d => [d, c.canisterId.toText()]),
        ['identity_access', shared.canisterId.toText()]]) } as IcpTargetConfig));
    const deployment = { id: 'boundary', alias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet',
      revision: 1n, enabled: true, additionalSubnetsEnabled: false, primarySubnet: 'local', approvedSubnets: ['local'] };
    const groups = clubs.map((c, i) => ({ id: i ? 'new' : 'legacy', targetAlias: 'mainnet',
      domains: GROUP_DOMAINS.map(domain => ({ domain, canisterId: c.canisterId.toText() })) }));
    const registry = { revision: 1n, deployment, groups, bindings: groups.map(g => ({ groupId: g.id,
      deploymentId: deployment.id, deploymentRevision: 1n, domains: g.domains.map(d => ({ ...d, subnetId: 'local' })) })) } as GroupRegistry;
    const identity = { getPrincipal: () => primary } as Identity;
    let unavailable = false;
    let mutateAfterRevoke = false;
    let discoveryDrift = false;
    let reads = 0;
    seam.purges = [];
    seam.identity = async (_t: IcpTargetConfig, human: Identity) => ({ client: {
      whoami: async () => { id.setPrincipal(human.getPrincipal()); return ok(await id.whoami()); },
      eraseAccount: async (accountId: string) => { id.setPrincipal(human.getPrincipal()); ok(await id.erase_account(accountId)); },
      dispose: () => {},
    } });
    seam.connect = async (t: IcpTargetConfig, human: Identity) => {
      const index = clubs.findIndex(c => c.canisterId.toText() === t.canisterIds.club_domain);
      if (index < 0) throw new Error('Unknown authority');
      // Explicit connector outage injection while the real authority is stopped.
      if (index === 1 && unavailable) throw new Error('Authority unavailable');
      const actor = clubs[index].actor;
      actor.setPrincipal(human.getPrincipal());
      return { actor: { erase_account_membership: (a: string) => actor.erase_account_membership(a),
        erase_my_membership: async () => { const r = await actor.erase_my_membership();
          if (index === 0 && mutateAfterRevoke) registry.revision += 1n;
          return r;
        } } };
    };
    seam.session = async (ctx: any) => openGroupSession(ctx, {
      readRegistry: async () => { reads++; if (discoveryDrift && reads > 1) registry.revision += 1n; return structuredClone(registry); },
      readMembershipsIndexed: async ctx => {
        const index = clubs.findIndex(c => c.canisterId.toText() === ctx.target.canisterIds.club_domain);
        if (index < 0 || (index === 1 && unavailable)) throw new Error('Authority unavailable');
        const actor = clubs[index].actor; actor.setPrincipal(primary);
        const page = ok(await actor.read_my_club_memberships_indexed([], 100));
        return { clubs: page.clubs, next: page.next[0] ?? null, aclRevision: page.acl_revision };
      },
      readMemberships: async () => { throw new Error('Unexpected fallback'); },
      readAssignments: async ids => ids.map(clubId => ({ clubId, groupId: clubId, revision: 1n })),
    });
    const roles = async (index: number, subject: Principal) => {
      clubs[index].actor.setPrincipal(subject); return clubs[index].actor.my_role_grants();
    };
    return { primary, linked, account, id, clubs, targets, identity, roles,
      unavailable: (v: boolean) => { unavailable = v; }, drift: () => { discoveryDrift = true; },
      midRemovalDrift: () => { mutateAfterRevoke = true; } };
  }

  it('self deletion revokes both linked principals in legacy and new groups before shared erasure', async () => {
    const f = await fixture(); await eraseMyIcpAccount(f.identity, f.targets[0]);
    for (const principal of [f.primary, f.linked]) {
      for (let i = 0; i < 2; i++) expect(await f.roles(i, principal)).toEqual([]);
      f.id.setPrincipal(principal); expect(await f.id.register_account()).toHaveProperty('Err');
    }
    expect(seam.purges).toHaveLength(6); // Purge transports are stubs, not content-erasure evidence.
  }, 60000);

  it('discovery outage preserves identity; resumed self deletion denies fresh role access', async () => {
    const f = await fixture();
    await pic.stopCanister({ canisterId: f.clubs[1].canisterId, sender: governor }); f.unavailable(true);
    await expect(eraseMyIcpAccount(f.identity, f.targets[0])).rejects.toThrow('unavailable');
    f.id.setPrincipal(f.primary); expect(ok(await f.id.whoami()).id).toBe(f.account.id);
    expect(await f.roles(0, f.linked)).toHaveLength(1); expect(seam.purges).toEqual([]);
    await pic.startCanister({ canisterId: f.clubs[1].canisterId, sender: governor }); f.unavailable(false);
    await eraseMyIcpAccount(f.identity, f.targets[0]);
    for (let i = 0; i < 2; i++) expect(await f.roles(i, f.linked)).toEqual([]);
  }, 60000);

  it('registry drift during discovery prevents any deletion', async () => {
    const f = await fixture(); f.drift();
    await expect(eraseMyIcpAccount(f.identity, f.targets[0])).rejects.toThrow('registry changed');
    f.id.setPrincipal(f.primary); expect(ok(await f.id.whoami()).id).toBe(f.account.id);
    for (let i = 0; i < 2; i++) expect(await f.roles(i, f.linked)).toHaveLength(1);
  }, 60000);

  it('records the unresolved mid-removal registry boundary without claiming safety', async () => {
    const f = await fixture(); f.midRemovalDrift();
    // Characterization of a release blocker, not an approved behavior rule:
    // the entrypoint closes its session before writes and never revalidates.
    await eraseMyIcpAccount(f.identity, f.targets[0]);
    f.id.setPrincipal(f.primary); expect(await f.id.whoami()).toHaveProperty('Err');
  }, 60000);

  it('records the admin gap: shared erasure leaves new-group linked roles intact', async () => {
    const f = await fixture();
    const admin = { getPrincipal: () => governor } as Identity;
    await eraseIcpAccountAsAdmin(admin, f.targets[0], f.account.id);
    for (const principal of [f.primary, f.linked]) {
      expect(await f.roles(0, principal)).toEqual([]);
      expect(await f.roles(1, principal)).toHaveLength(1);
      f.id.setPrincipal(principal); expect(await f.id.whoami()).toHaveProperty('Err');
      expect(await f.id.register_account()).toHaveProperty('Err');
    }
  }, 60000);
});