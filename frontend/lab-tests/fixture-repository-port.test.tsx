import { Principal } from '@icp-sdk/core/principal';
import { describe, expect, it, vi } from 'vitest';
import { createCompetitionDomainClient } from '../src/lab/localCompetitionService';
import type { _SERVICE } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';

const principal = Principal.fromText('aaaaa-aa');

function state() {
  return {
    schema: 1,
    governor: principal,
    competitions: [
      {
        id: 'competition-1',
        name: 'Winter League',
        season: '2026',
        status: 'active',
        club_id: 'club-1',
        revision: 2n,
      },
      {
        id: 'competition-2',
        name: 'Spring Cup',
        season: '2026',
        status: 'draft',
        club_id: 'club-2',
        revision: 1n,
      },
    ],
    entries: [
      { competition_id: 'competition-1', team_id: 'team-1', club_id: 'club-1', status: 'accepted' },
      { competition_id: 'competition-2', team_id: 'team-2', club_id: 'club-2', status: 'accepted' },
    ],
    seasons: [
      { competition_id: 'competition-1', name: '2026', status: 'active', revision: 1n },
    ],
    matches: [
      {
        id: 'match-1',
        competition_id: 'competition-1',
        home_team: 'team-1',
        away_team: 'team-3',
        home_score: 0,
        away_score: 0,
        status: 'scheduled',
        revision: 1n,
      },
      {
        id: 'match-2',
        competition_id: 'competition-2',
        home_team: 'team-2',
        away_team: 'team-4',
        home_score: 0,
        away_score: 0,
        status: 'scheduled',
        revision: 1n,
      },
    ],
    tokens: [],
    roles: [],
  };
}

function client(exportState: ReturnType<typeof state>) {
  return createCompetitionDomainClient({
    export_state: vi.fn(async () => ({ Ok: exportState })),
    create_competition: vi.fn(),
    claim_join_token: vi.fn(),
    issue_join_token: vi.fn(),
    create_season: vi.fn(),
    set_season_status: vi.fn(),
    record_match: vi.fn(),
    set_match_result: vi.fn(),
    register_team: vi.fn(),
  } as unknown as _SERVICE);
}

describe('ported fixture repository use cases', () => {
  it('reads synthetic local fixtures in competition scope and preserves canister order', async () => {
    const competition = await client(state()).getCompetitionState('competition-1');

    expect(competition.matches.map((match) => match.id)).toEqual(['match-1']);
    expect(competition.entries.map((entry) => entry.team_id)).toEqual(['team-1']);
    expect(competition.seasons.map((season) => season.name)).toEqual(['2026']);
  });

  it('propagates local state errors and rejects an unknown competition', async () => {
    const exportState = vi.fn(async () => ({ Err: 'fixtures unavailable' }));
    const localClient = createCompetitionDomainClient({
      export_state: exportState,
      create_competition: vi.fn(),
      claim_join_token: vi.fn(),
      issue_join_token: vi.fn(),
      create_season: vi.fn(),
      set_season_status: vi.fn(),
      record_match: vi.fn(),
      set_match_result: vi.fn(),
      register_team: vi.fn(),
    } as unknown as _SERVICE);

    await expect(localClient.getCompetitionState('competition-1'))
      .rejects.toThrow('fixtures unavailable');
    await expect(client(state()).getCompetitionState('missing'))
      .rejects.toThrow('Competition not found');
  });
});
