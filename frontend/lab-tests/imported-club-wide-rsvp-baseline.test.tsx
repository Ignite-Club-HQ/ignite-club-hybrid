import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
import {
  resolveClubBackend,
  type BackendProviders,
} from '../src/lab/backendRouter';
import type { PlacementRegistry } from '../src/lab/hybridClubLinksService';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

type Grouping = 'level' | 'team';

type ClubGame = {
  id: string;
  clubId: string;
  title: string;
  grouping: Grouping;
  targetTeamIds: string[] | null;
};

type GameActor = {
  id: string;
  clubId: string;
  role: 'admin' | 'committee' | 'member';
};

type ClubGameClient = {
  create(
    actor: GameActor,
    title: string,
    grouping: Grouping,
    teamId?: string | null,
    targetTeamIds?: string[] | null,
  ): Promise<ClubGame>;
  update(
    actor: GameActor,
    gameId: string,
    grouping: Grouping,
    targetTeamIds?: string[] | null,
  ): Promise<ClubGame>;
  get(actor: GameActor, gameId: string): Promise<ClubGame | undefined>;
};

const CLUB_A = 'club-rsvp-a';
const CLUB_B = 'club-rsvp-b';
const TEAM_A = 'team-rsvp-a';
const TEAM_A_SECOND = 'team-rsvp-a-second';
const TEAM_B = 'team-rsvp-b';
const ADMIN_A: GameActor = { id: 'rsvp-admin-a', clubId: CLUB_A, role: 'admin' };
const COMMITTEE_A: GameActor = { id: 'rsvp-committee-a', clubId: CLUB_A, role: 'committee' };
const MEMBER_A: GameActor = { id: 'rsvp-member-a', clubId: CLUB_A, role: 'member' };

function createClubGameClient(): ClubGameClient {
  const games = new Map<string, ClubGame>();
  const teamsByClub = new Map([
    [CLUB_A, new Set([TEAM_A, TEAM_A_SECOND])],
    [CLUB_B, new Set([TEAM_B])],
  ]);
  return {
    async create(actor, title, grouping, teamId = null, targetTeamIds = null) {
      if (actor.role === 'member') throw new Error('Club admin or committee member required');
      if (teamId !== null && grouping !== 'level') throw new Error('Grouping is only valid for club-wide games');
      if (!['level', 'team'].includes(grouping)) throw new Error('Invalid RSVP grouping');
      if (teamId !== null && !teamsByClub.get(actor.clubId)?.has(teamId)) {
        throw new Error('Team is outside the club');
      }
      if (targetTeamIds && targetTeamIds.some(id => !teamsByClub.get(actor.clubId)?.has(id))) {
        throw new Error('Target team is outside the club');
      }
      const game = {
        id: `game-${games.size + 1}`,
        clubId: actor.clubId,
        title,
        grouping,
        targetTeamIds,
      };
      games.set(game.id, game);
      return game;
    },
    async update(actor, gameId, grouping, targetTeamIds = null) {
      const game = games.get(gameId);
      if (!game || game.clubId !== actor.clubId || actor.role === 'member') {
        throw new Error('Club admin or committee member required');
      }
      if (targetTeamIds && targetTeamIds.some(id => !teamsByClub.get(actor.clubId)?.has(id))) {
        throw new Error('Target team is outside the club');
      }
      game.grouping = grouping;
      game.targetTeamIds = targetTeamIds;
      return game;
    },
    async get(actor, gameId) {
      const game = games.get(gameId);
      return game?.clubId === actor.clubId ? game : undefined;
    },
  };
}

async function routedClient(
  registry: PlacementRegistry,
  providers: BackendProviders<ClubGameClient>,
  clients: Map<string, ClubGameClient>,
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
  test(`preserves club-wide RSVP grouping semantics in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([
      {
        clubId: CLUB_A,
        country: 'AU',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'rsvp-au' } }
          : { Icp: { canister: Principal.fromText('aaaaa-aa') } },
      },
      {
        clubId: CLUB_B,
        country: 'US',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'rsvp-us' } }
          : { Icp: { canister: Principal.fromText('2vxsx-fae') } },
      },
    ]);
    const calls: string[] = [];
    const clients = new Map<string, ClubGameClient>();
    const getClient = (key: string) => {
      let client = clients.get(key);
      if (!client) {
        client = createClubGameClient();
        clients.set(key, client);
      }
      return client;
    };
    const providers: BackendProviders<ClubGameClient> = {
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
    const crossClubClient = await routedClient(registry, providers, clients, CLUB_B);

    await expect(client.create(MEMBER_A, 'Unauthorized game', 'level'))
      .rejects.toThrow('Club admin or committee member required');
    const game = await client.create(ADMIN_A, 'Synthetic club game', 'level');
    expect(game.targetTeamIds).toBeNull();
    await expect(client.update(ADMIN_A, game.id, 'team', [TEAM_A, TEAM_A_SECOND]))
      .resolves.toMatchObject({ grouping: 'team', targetTeamIds: [TEAM_A, TEAM_A_SECOND] });
    await expect(client.create(ADMIN_A, 'Invalid team grouping', 'team', TEAM_A))
      .rejects.toThrow('Grouping is only valid for club-wide games');
    await expect(client.create(ADMIN_A, 'Cross-club targets', 'team', null, [TEAM_A, TEAM_B]))
      .rejects.toThrow('Target team is outside the club');

    const committeeGame = await client.create(
      COMMITTEE_A,
      'Synthetic committee game',
      'team',
      null,
      [TEAM_A, TEAM_A_SECOND],
    );
    await expect(client.get(COMMITTEE_A, committeeGame.id)).resolves.toMatchObject({
      title: 'Synthetic committee game',
      targetTeamIds: [TEAM_A, TEAM_A_SECOND],
    });
    await expect(crossClubClient.get({ id: 'rsvp-outsider-b', clubId: CLUB_B, role: 'member' }, game.id))
      .resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.startsWith(mode === 'supabase' ? 'supabase:' : 'icp:'))).toBe(true);
  });
}

test('does not fall back to Supabase when the selected ICP RSVP provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } },
  }]);
  const providers: BackendProviders<ClubGameClient> = {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP RSVP provider unavailable');
    },
  };

  await expect(routedClient(registry, providers, new Map(), CLUB_A))
    .rejects.toThrow('local ICP RSVP provider unavailable');
  expect(supabaseCalls).toBe(0);
});
