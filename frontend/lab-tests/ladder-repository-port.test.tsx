import { Principal } from '@icp-sdk/core/principal';
import { describe, expect, it, vi } from 'vitest';
import {
  addAcceptedEntryPlaceholders,
  enrichLadderRows,
} from '../src/features/competitions/ladder/ladderModel';
import { createCompetitionDomainClient } from '../src/lab/localCompetitionService';
import type { _SERVICE } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';

const principal = Principal.fromText('aaaaa-aa');

function localClient() {
  return createCompetitionDomainClient({
    export_state: vi.fn(async () => ({
      Ok: {
        schema: 1,
        governor: principal,
        competitions: [
          {
            id: 'competition-1',
            name: 'Winter League',
            season: '2026',
            status: 'active',
            club_id: 'club-1',
            revision: 1n,
          },
          {
            id: 'competition-2',
            name: 'Spring Cup',
            season: '2026',
            status: 'active',
            club_id: 'club-2',
            revision: 1n,
          },
        ],
        entries: [
          { competition_id: 'competition-1', team_id: 'team-1', club_id: 'club-1', status: 'accepted' },
          { competition_id: 'competition-1', team_id: 'team-2', club_id: 'club-1', status: 'accepted' },
          { competition_id: 'competition-1', team_id: 'team-3', club_id: 'club-1', status: 'pending' },
          { competition_id: 'competition-2', team_id: 'team-4', club_id: 'club-2', status: 'accepted' },
        ],
        seasons: [],
        matches: [],
        tokens: [],
        roles: [],
      },
    })),
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

function playedRow(teamId: string) {
  return {
    competition_id: 'competition-1',
    team_id: teamId,
    division_id: 'division-1',
    played: teamId === 'team-1' ? 1 : 0,
    wins: teamId === 'team-1' ? 1 : 0,
    draws: 0,
    losses: 0,
    goals_for: teamId === 'team-1' ? 2 : 0,
    goals_against: 0,
    goal_diff: teamId === 'team-1' ? 2 : 0,
    points: teamId === 'team-1' ? 3 : 0,
  };
}

describe('ported ladder repository use cases', () => {
  it('scopes accepted entries, adds missing placeholders and enriches every local row', async () => {
    const state = await localClient().getCompetitionState('competition-1');
    const acceptedEntries = state.entries
      .filter((entry) => entry.status === 'accepted')
      .map(({ team_id, status }) => ({ team_id, status, division_id: 'division-1' }));
    const rows = addAcceptedEntryPlaceholders(
      'competition-1',
      [playedRow('team-1')],
      acceptedEntries,
    );
    const enriched = enrichLadderRows(rows, [
      { id: 'team-1', name: 'Riverside' },
      { id: 'team-2', name: 'Hilltown' },
    ]);

    expect(enriched.map((row) => [row.team_id, row.teams?.name, row.played]))
      .toEqual([
        ['team-1', 'Riverside', 1],
        ['team-2', 'Hilltown', 0],
      ]);
    expect(enriched.some((row) => row.team_id === 'team-3')).toBe(false);
  });

  it('does not mix entries from another local competition', async () => {
    const state = await localClient().getCompetitionState('competition-1');

    expect(state.entries.map((entry) => entry.team_id)).toEqual(['team-1', 'team-2', 'team-3']);
  });
});
