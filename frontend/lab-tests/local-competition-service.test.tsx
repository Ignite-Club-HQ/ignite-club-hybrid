import { describe, expect, test, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createCompetitionDomainClient } from '../src/lab/localCompetitionService';
import type { _SERVICE } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';

const principal = Principal.fromText('aaaaa-aa');

describe('local competition service', () => {
  test('lists competitions from exported canister state', async () => {
    const exportState = vi.fn(async () => ({
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
            revision: 2n,
          },
        ],
        seasons: [],
        entries: [],
        matches: [],
        tokens: [],
        roles: [],
      },
    }));
    const client = createCompetitionDomainClient({
      export_state: exportState,
      create_competition: vi.fn(),
      claim_join_token: vi.fn(),
    } as unknown as _SERVICE);

    await expect(client.listCompetitions()).resolves.toEqual([
      expect.objectContaining({
        id: 'competition-1',
        name: 'Winter League',
        season: '2026',
        status: 'active',
        organizer_club_id: 'club-1',
        source: 'icp',
      }),
    ]);
    expect(exportState).toHaveBeenCalledOnce();
  });

  test('gets one competition from exported canister state', async () => {
    const client = createCompetitionDomainClient({
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
              revision: 2n,
            },
          ],
          seasons: [],
          entries: [],
          matches: [],
          tokens: [],
          roles: [],
        },
      })),
      create_competition: vi.fn(),
      claim_join_token: vi.fn(),
    } as unknown as _SERVICE);

    await expect(client.getCompetition('competition-1')).resolves.toMatchObject({
      id: 'competition-1',
      name: 'Winter League',
    });
    await expect(client.getCompetition('missing')).rejects.toThrow('Competition not found');
  });

  test('creates competitions through the local canister actor', async () => {
    const createCompetition = vi.fn(async () => ({
      Ok: {
        id: 'competition-2',
        name: 'Cup',
        season: '2026',
        status: 'draft',
        club_id: 'club-1',
        revision: 1n,
      },
    }));
    const client = createCompetitionDomainClient({
      export_state: vi.fn(),
      create_competition: createCompetition,
      claim_join_token: vi.fn(),
    } as unknown as _SERVICE);

    await expect(client.createCompetition('club-1', 'Cup', '2026')).resolves.toMatchObject({
      id: 'competition-2',
      name: 'Cup',
      status: 'draft',
    });
    expect(createCompetition).toHaveBeenCalledWith('club-1', 'Cup', '2026');
  });

  test('claims a join token through the local canister actor', async () => {
    const claimJoinToken = vi.fn(async () => ({ Ok: 'claimed' }));
    const client = createCompetitionDomainClient({
      export_state: vi.fn(),
      create_competition: vi.fn(),
      claim_join_token: claimJoinToken,
    } as unknown as _SERVICE);

    await expect(client.claimJoinToken('token-1')).resolves.toBe('claimed');
    expect(claimJoinToken).toHaveBeenCalledWith('token-1');
  });

  test('issues a join token through the local canister actor', async () => {
    const issueJoinToken = vi.fn(async () => ({
      Ok: { id: 'token-1', competition_id: 'competition-1', team_id: 'team-1', issued_by: principal, expires_at_ms: 20n, used: false },
    }));
    const client = createCompetitionDomainClient({
      export_state: vi.fn(),
      create_competition: vi.fn(),
      claim_join_token: vi.fn(),
      issue_join_token: issueJoinToken,
    } as unknown as _SERVICE);

    await expect(client.issueJoinToken('competition-1', 'team-1', 20n)).resolves.toMatchObject({
      id: 'token-1',
      team_id: 'team-1',
      used: false,
    });
    expect(issueJoinToken).toHaveBeenCalledWith('competition-1', 'team-1', 20n);
  });

  test('registers a team through the local canister actor', async () => {
    const registerTeam = vi.fn(async () => ({
      Ok: { competition_id: 'competition-1', team_id: 'team-1', club_id: 'club-1', status: 'registered' },
    }));
    const client = createCompetitionDomainClient({
      export_state: vi.fn(),
      create_competition: vi.fn(),
      claim_join_token: vi.fn(),
      register_team: registerTeam,
    } as unknown as _SERVICE);

    await expect(client.registerTeam('competition-1', 'team-1', 'club-1')).resolves.toMatchObject({
      competition_id: 'competition-1',
      team_id: 'team-1',
      status: 'registered',
    });
    expect(registerTeam).toHaveBeenCalledWith('competition-1', 'team-1', 'club-1');
  });

  test('creates seasons, records matches, and saves match results', async () => {
    const createSeason = vi.fn(async () => ({
      Ok: { competition_id: 'competition-1', name: 'Spring', status: 'draft', revision: 1n },
    }));
    const recordMatch = vi.fn(async () => ({
      Ok: {
        id: 'match-1',
        competition_id: 'competition-1',
        home_team: 'team-a',
        away_team: 'team-b',
        home_score: 0,
        away_score: 0,
        status: 'scheduled',
        revision: 1n,
      },
    }));
    const setMatchResult = vi.fn(async () => ({
      Ok: {
        id: 'match-1',
        competition_id: 'competition-1',
        home_team: 'team-a',
        away_team: 'team-b',
        home_score: 2,
        away_score: 1,
        status: 'completed',
        revision: 2n,
      },
    }));
    const client = createCompetitionDomainClient({
      export_state: vi.fn(),
      create_competition: vi.fn(),
      claim_join_token: vi.fn(),
      create_season: createSeason,
      set_season_status: vi.fn(),
      record_match: recordMatch,
      set_match_result: setMatchResult,
    } as unknown as _SERVICE);

    await expect(client.createSeason('competition-1', 'Spring')).resolves.toMatchObject({ name: 'Spring' });
    await expect(client.recordMatch('competition-1', 'team-a', 'team-b')).resolves.toMatchObject({ id: 'match-1' });
    await expect(client.setMatchResult('match-1', 2, 1, 1n)).resolves.toMatchObject({ home_score: 2, away_score: 1 });
    expect(createSeason).toHaveBeenCalledWith('competition-1', 'Spring');
    expect(recordMatch).toHaveBeenCalledWith('competition-1', 'team-a', 'team-b');
    expect(setMatchResult).toHaveBeenCalledWith('match-1', 2, 1, 1n);
  });
});
