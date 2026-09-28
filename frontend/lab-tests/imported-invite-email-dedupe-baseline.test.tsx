import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
import {
  createHybridInviteDedupeService,
  isPlausibleInvitableEmail,
  type InviteDedupeProvider,
} from '../src/lab/hybridInviteDedupe';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-invite-a';
const ICP_A = Principal.fromText('aaaaa-aa');
const MATCH = {
  user_id: 'member-1',
  display_name: 'Synthetic Member',
  avatar_url: null,
  already_in_club: true,
  already_in_team: false,
  already_in_mini_league: false,
};

test('preserves the bundle helper email acceptance boundary', () => {
  expect(isPlausibleInvitableEmail('alice@example.com')).toBe(true);
  expect(isPlausibleInvitableEmail('First.Last+tag@sub.example.co')).toBe(true);
  expect(isPlausibleInvitableEmail('a b@example.com')).toBe(false);
  expect(isPlausibleInvitableEmail('x@example')).toBe(false);
  expect(isPlausibleInvitableEmail('a..b@example.com')).toBe(false);
});

for (const mode of ['supabase', 'icp'] as const) {
  test(`preserves invite dedupe lookup in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase'
        ? { Supabase: { environment: 'invites-au' } }
        : { Icp: { canister: ICP_A } },
    }]);
    const calls: string[] = [];
    const requests: unknown[] = [];
    const provider: InviteDedupeProvider = {
      lookup: async request => {
        requests.push(request);
        return [MATCH, { user_id: 'ignored' }];
      },
    };
    const service = createHybridInviteDedupeService(registry, {
      supabase: async environment => {
        calls.push(`supabase:${environment}`);
        return provider;
      },
      icp: async canister => {
        calls.push(`icp:${canister.toText()}`);
        return provider;
      },
    });

    await expect(service.lookup({
      email: '  MEMBER@Example.COM ',
      clubId: CLUB_A,
      teamId: 'team-a',
    })).resolves.toEqual({
      userId: 'member-1',
      displayName: 'Synthetic Member',
      avatarUrl: null,
      alreadyInClub: true,
      alreadyInTeam: false,
      alreadyInMiniLeague: false,
    });
    await service.lookup({ email: 'member@example.com', clubId: CLUB_A });

    expect(calls).toEqual([mode === 'supabase' ? 'supabase:invites-au' : `icp:${ICP_A.toText()}`]);
    expect(requests).toEqual([
      { email: 'member@example.com', clubId: CLUB_A, teamId: 'team-a', miniLeagueId: null },
      { email: 'member@example.com', clubId: CLUB_A, teamId: null, miniLeagueId: null },
    ]);
  });
}

test('rejects malformed emails before placement or provider access', async () => {
  const registry = createSyntheticPlacementRegistry();
  let providerCalls = 0;
  const service = createHybridInviteDedupeService(registry, {
    supabase: async () => {
      providerCalls += 1;
      throw new Error('provider must not be called');
    },
    icp: async () => {
      providerCalls += 1;
      throw new Error('provider must not be called');
    },
  });

  await expect(service.lookup({ email: 'not-an-email', clubId: 'missing-club' })).resolves.toBeNull();
  expect(providerCalls).toBe(0);
});

test('does not fall back to Supabase when the selected ICP provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const service = createHybridInviteDedupeService(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => ({
      lookup: async () => {
        throw new Error('local ICP invite lookup unavailable');
      },
    }),
  });

  await expect(service.lookup({ email: 'member@example.com', clubId: CLUB_A }))
    .rejects.toThrow('local ICP invite lookup unavailable');
  expect(supabaseCalls).toBe(0);
});

test('returns null for malformed provider data without weakening routing', async () => {
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const service = createHybridInviteDedupeService(registry, {
    supabase: async () => ({ lookup: async () => null }),
    icp: async () => ({ lookup: async () => ({ user_id: 42 }) }),
  });

  await expect(service.lookup({ email: 'member@example.com', clubId: CLUB_A })).resolves.toBeNull();
});
