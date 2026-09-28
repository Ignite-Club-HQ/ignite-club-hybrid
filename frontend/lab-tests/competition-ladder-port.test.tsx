import { describe, expect, it } from 'vitest';
import {
  groupLadderRows,
  visibleLadderRows,
} from '../src/features/competitions/ladder/ladderModel';

function row(teamId: string, divisionId: string, overrides: Record<string, unknown> = {}) {
  return {
    competition_id: 'competition-1',
    team_id: teamId,
    division_id: divisionId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals_for: 0,
    goals_against: 0,
    goal_diff: 0,
    points: 0,
    teams: { id: teamId, name: 'Riverside Blue' },
    ...overrides,
  };
}

describe('ported competition ladder use cases', () => {
  it('represents a not-started division with a zeroed row and ranks played standings', () => {
    const groups = groupLadderRows([
      row('team-1', 'division-1', {
        played: 2,
        wins: 2,
        goals_for: 5,
        goal_diff: 3,
        points: 6,
      }),
      row('team-2', 'division-1', { teams: { id: 'team-2', name: 'Hilltown' } }),
    ], [{ id: 'division-1', name: 'Under 10' }]);

    expect(groups[0].rows.map((standing) => [
      standing.team_id,
      standing.played,
      standing.goal_diff,
      standing.points,
    ])).toEqual([
      ['team-1', 2, 3, 6],
      ['team-2', 0, 0, 0],
    ]);
  });

  it('hides all standings from members when a division is hidden but leaves them visible to admins', () => {
    const rows = [row('team-1', 'division-1', { played: 1 })];
    const divisions = [{ id: 'division-1', name: 'Under 10', hide_ladder: true }];

    expect(visibleLadderRows(rows, divisions, false)).toEqual([]);
    expect(visibleLadderRows(rows, divisions, true)).toBe(rows);
  });

  it('keeps a selected team visible across every division in which it participates', () => {
    const rows = [
      row('team-1', 'division-1'),
      row('team-2', 'division-1'),
      row('team-1', 'division-2'),
    ];
    const groups = groupLadderRows(rows, [
      { id: 'division-1', name: 'Under 10' },
      { id: 'division-2', name: 'Under 12' },
    ]);

    expect(groups.map((group) => [group.divisionId, group.rows.map((standing) => standing.team_id)]))
      .toEqual([
        ['division-1', ['team-1', 'team-2']],
        ['division-2', ['team-1']],
      ]);
  });
});
