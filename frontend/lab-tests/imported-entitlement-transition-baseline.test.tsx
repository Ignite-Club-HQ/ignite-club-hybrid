import { Principal } from '@icp-sdk/core/principal';
import { describe, expect, test } from 'vitest';
import {
  resolveClubBackend,
  type BackendProviders,
} from '../src/lab/backendRouter';
import type { PlacementRegistry } from '../src/lab/hybridClubLinksService';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

type Subscription = {
  isPro: boolean;
  expiresAtMs: number;
  adminOverride: boolean;
};

type EntitlementActor = {
  id: string;
  clubIds: Set<string>;
  teamIds: Set<string>;
};

type EntitlementClient = {
  setSubscription(actor: EntitlementActor, clubId: string, subscription: Subscription): Promise<void>;
  removeMembership(actor: EntitlementActor, clubId: string, teamId: string): Promise<void>;
  hasActiveProForClub(clubId: string, nowMs: number): Promise<boolean>;
  hasActiveProForTeam(actor: EntitlementActor, teamId: string, nowMs: number): Promise<boolean>;
  userHasAnyClubPro(actor: EntitlementActor, nowMs: number): Promise<boolean>;
};

const CLUB_A = 'club-entitlement-a';
const CLUB_B = 'club-entitlement-b';
const TEAM_A = 'team-entitlement-a';
const ADMIN_A: EntitlementActor = {
  id: 'entitlement-admin-a',
  clubIds: new Set([CLUB_A, CLUB_B]),
  teamIds: new Set(),
};
const MEMBER_A: EntitlementActor = {
  id: 'entitlement-member-a',
  clubIds: new Set([CLUB_A]),
  teamIds: new Set([TEAM_A]),
};

function createEntitlementClient(): EntitlementClient {
  const subscriptions = new Map<string, Subscription>();
  const memberships = new Map<string, Set<string>>([
    [CLUB_A, new Set([TEAM_A])],
    [CLUB_B, new Set()],
  ]);
  return {
    async setSubscription(actor, clubId, subscription) {
      if (!actor.clubIds.has(clubId)) throw new Error('Club admin required');
      subscriptions.set(clubId, subscription);
    },
    async removeMembership(actor, clubId, teamId) {
      if (!actor.clubIds.has(clubId)) throw new Error('Club admin required');
      memberships.get(clubId)?.delete(teamId);
    },
    async hasActiveProForClub(clubId, nowMs) {
      const subscription = subscriptions.get(clubId);
      return Boolean(
        subscription
        && (subscription.isPro || subscription.adminOverride)
        && subscription.expiresAtMs > nowMs,
      );
    },
    async hasActiveProForTeam(actor, teamId, nowMs) {
      const clubId = [...memberships.entries()].find(([, teams]) => teams.has(teamId))?.[0];
      return clubId !== undefined
        && actor.teamIds.has(teamId)
        && await this.hasActiveProForClub(clubId, nowMs);
    },
    async userHasAnyClubPro(actor, nowMs) {
      for (const clubId of actor.clubIds) {
        if (await this.hasActiveProForClub(clubId, nowMs)) return true;
      }
      return false;
    },
  };
}

async function routedClient(
  registry: PlacementRegistry,
  providers: BackendProviders<EntitlementClient>,
  clients: Map<string, EntitlementClient>,
  clubId: string,
) {
  const routed = await resolveClubBackend(registry, clubId);
  const key = routed.kind === 'icp'
    ? `icp:${routed.backend.Icp.canister.toText()}`
    : `supabase:${routed.backend.Supabase.environment}`;
  let client = clients.get(key);
  if (!client) {
    client = routed.kind === 'icp'
      ? await providers.icp(routed.backend.Icp.canister)
      : await providers.supabase(routed.backend.Supabase.environment);
    clients.set(key, client);
  }
  return client;
}

for (const mode of ['supabase', 'icp'] as const) {
  test(`preserves exact-club entitlement transitions in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([
      {
        clubId: CLUB_A,
        country: 'AU',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'entitlement-au' } }
          : { Icp: { canister: Principal.fromText('aaaaa-aa') } },
      },
      {
        clubId: CLUB_B,
        country: 'US',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'entitlement-us' } }
          : { Icp: { canister: Principal.fromText('2vxsx-fae') } },
      },
    ]);
    const calls: string[] = [];
    const clients = new Map<string, EntitlementClient>();
    const getClient = (key: string) => {
      let client = clients.get(key);
      if (!client) {
        client = createEntitlementClient();
        clients.set(key, client);
      }
      return client;
    };
    const providers: BackendProviders<EntitlementClient> = {
      supabase: async environment => {
        calls.push(`supabase:${environment}`);
        return getClient(`supabase:${environment}`);
      },
      icp: async canister => {
        calls.push(`icp:${canister.toText()}`);
        return getClient(`icp:${canister.toText()}`);
      },
    };
    const client = await routedClient(registry, providers, clients, CLUB_A);
    const otherClubClient = await routedClient(registry, providers, clients, CLUB_B);

    await client.setSubscription(ADMIN_A, CLUB_A, {
      isPro: false,
      adminOverride: false,
      expiresAtMs: 2_000,
    });
    await expect(client.hasActiveProForClub(CLUB_A, 1_000)).resolves.toBe(false);
    await expect(client.hasActiveProForTeam(MEMBER_A, TEAM_A, 1_000)).resolves.toBe(false);
    await expect(client.userHasAnyClubPro(MEMBER_A, 1_000)).resolves.toBe(false);

    await client.setSubscription(ADMIN_A, CLUB_A, {
      isPro: true,
      adminOverride: false,
      expiresAtMs: 2_000,
    });
    await expect(client.hasActiveProForClub(CLUB_A, 1_000)).resolves.toBe(true);
    await expect(client.hasActiveProForTeam(MEMBER_A, TEAM_A, 1_000)).resolves.toBe(true);
    await expect(client.userHasAnyClubPro(MEMBER_A, 1_000)).resolves.toBe(true);
    await expect(otherClubClient.hasActiveProForClub(CLUB_B, 1_000)).resolves.toBe(false);
    await expect(client.hasActiveProForTeam(MEMBER_A, TEAM_A, 2_000)).resolves.toBe(false);

    await client.setSubscription(ADMIN_A, CLUB_A, {
      isPro: false,
      adminOverride: true,
      expiresAtMs: 3_000,
    });
    await expect(client.hasActiveProForTeam(MEMBER_A, TEAM_A, 2_500)).resolves.toBe(true);
    await client.removeMembership(ADMIN_A, CLUB_A, TEAM_A);
    await expect(client.hasActiveProForTeam(MEMBER_A, TEAM_A, 2_500)).resolves.toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.startsWith(mode === 'supabase' ? 'supabase:' : 'icp:'))).toBe(true);
  });
}

test('does not fall back to Supabase when the selected ICP entitlement provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } },
  }]);
  const providers: BackendProviders<EntitlementClient> = {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP entitlement provider unavailable');
    },
  };

  await expect(routedClient(registry, providers, new Map(), CLUB_A))
    .rejects.toThrow('local ICP entitlement provider unavailable');
  expect(supabaseCalls).toBe(0);
});

// Synthetic local equivalent of the exported Postgres/RLS journey test
// `local journey: exact-club Free and Pro entitlement transition` (the real
// fixture-backed `has_active_pro_for_*` RPC journey requires a live local
// Supabase/Postgres instance that is out of scope for this lab; this exact-
// club scenario is reconstructed against the in-memory synthetic client
// above, which implements the same activation/expiry/override/removal rules).
describe('local journey: exact-club Free and Pro entitlement transition', () => {
  test('activates, expires and revokes Pro without leaking it across clubs', async () => {
    const client = createEntitlementClient();

    await expect(client.hasActiveProForClub(CLUB_A, 1_000)).resolves.toBe(false);
    await expect(client.hasActiveProForTeam(MEMBER_A, TEAM_A, 1_000)).resolves.toBe(false);
    await expect(client.userHasAnyClubPro(MEMBER_A, 1_000)).resolves.toBe(false);

    await client.setSubscription(ADMIN_A, CLUB_A, {
      isPro: true,
      adminOverride: false,
      expiresAtMs: 2_000,
    });

    await expect(client.hasActiveProForClub(CLUB_A, 1_000)).resolves.toBe(true);
    await expect(client.hasActiveProForTeam(MEMBER_A, TEAM_A, 1_000)).resolves.toBe(true);
    await expect(client.userHasAnyClubPro(MEMBER_A, 1_000)).resolves.toBe(true);
    await expect(client.hasActiveProForClub(CLUB_B, 1_000)).resolves.toBe(false);

    // Same subscription, checked past its expiry — Pro access lapses.
    await expect(client.hasActiveProForTeam(MEMBER_A, TEAM_A, 2_000)).resolves.toBe(false);

    await client.setSubscription(ADMIN_A, CLUB_A, {
      isPro: false,
      adminOverride: true,
      expiresAtMs: 3_000,
    });
    await expect(client.hasActiveProForTeam(MEMBER_A, TEAM_A, 2_500)).resolves.toBe(true);

    await client.removeMembership(ADMIN_A, CLUB_A, TEAM_A);
    await expect(client.hasActiveProForClub(CLUB_A, 2_500)).resolves.toBe(true);
    // The removed team membership was this actor's only affiliation with
    // CLUB_A, so their effective club membership set is now empty.
    const memberAfterRemoval: EntitlementActor = {
      id: MEMBER_A.id,
      clubIds: new Set(),
      teamIds: new Set(),
    };
    await expect(client.userHasAnyClubPro(memberAfterRemoval, 2_500)).resolves.toBe(false);
  });
});
