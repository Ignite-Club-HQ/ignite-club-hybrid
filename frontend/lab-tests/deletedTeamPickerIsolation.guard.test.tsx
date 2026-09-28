import { describe, expect, it } from 'vitest';

type Team = { id: string; status: 'active' | 'deleted'; clubId: string };

function filterSelectableTeams(teams: Team[], clubId: string) {
  return teams.filter((team) => team.clubId === clubId && team.status === 'active');
}

describe('deleted team picker isolation guard', () => {
  it('does not surface deleted teams or foreign-club teams in the local picker', () => {
    const teams: Team[] = [
      { id: 'team-1', status: 'active', clubId: 'club-1' },
      { id: 'team-2', status: 'deleted', clubId: 'club-1' },
      { id: 'team-3', status: 'active', clubId: 'club-2' },
    ];

    expect(filterSelectableTeams(teams, 'club-1')).toEqual([{ id: 'team-1', status: 'active', clubId: 'club-1' }]);
  });
});
