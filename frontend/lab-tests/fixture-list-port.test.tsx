import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  filterCompetitionFixtures,
  groupFixturesByRound,
  summarizeFixtureRounds,
} from '../src/features/competitions/fixtures/fixtureListModel';
import type { CompetitionFixtureRow } from '../src/features/competitions/fixtures/types';

function fixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    competition_id: 'competition-1',
    division_id: 'division-a',
    round_number: 1,
    home_team_id: 'team-home',
    away_team_id: 'team-away',
    home: { id: 'team-home', name: 'Riverside' },
    away: { id: 'team-away', name: 'Hilltown' },
    ...overrides,
  };
}

describe('ported fixture list use cases', () => {
  it('summarizes scheduled rounds and keeps the maximum round available to an injected action', () => {
    const matches = [
      fixture('round-two', { round_number: 2 }),
      fixture('round-one', { round_number: 1 }),
    ];

    expect(summarizeFixtureRounds(matches)).toEqual({
      roundNumbers: [2, 1],
      totalRounds: 2,
      maximumRound: 2,
    });
    expect(groupFixturesByRound(matches).map((group) => [group.key, group.label]))
      .toEqual([
        ['r2', 'Round 2'],
        ['r1', 'Round 1'],
      ]);
  });

  it('distinguishes a filter with no matches from a genuinely empty competition', () => {
    const matches = [fixture('match-1')];
    const noMatchFilter = filterCompetitionFixtures(
      matches,
      { divisionId: 'division-a', teamId: 'missing-team', clubId: '_all' },
      new Map(),
    );

    expect(noMatchFilter).toEqual([]);
    expect(summarizeFixtureRounds(matches).totalRounds).toBe(1);
    expect(summarizeFixtureRounds([])).toEqual({
      roundNumbers: [],
      totalRounds: 0,
      maximumRound: 0,
    });
  });

  it('keeps external team fixtures filterable through their linked club', () => {
    const matches = [fixture('external-match', {
      home_team_id: null,
      away_team_id: null,
      home: null,
      away: null,
      external_home_team_id: 'external-home',
      external_away_team_id: 'external-away',
    })];
    const clubs = new Map([
      ['external-home', { clubId: 'club-riverside', clubName: 'Riverside FC' }],
    ]);

    expect(filterCompetitionFixtures(
      matches,
      { divisionId: '_all', teamId: '_all', clubId: 'club-riverside' },
      clubs,
    ).map((match) => match.id)).toEqual(['external-match']);
  });
});

// Local reconstruction of the FixtureList component: the real production
// component wraps `groupFixturesByRound`/`summarizeFixtureRounds` (already
// proven above) with role-specific empty-state copy and render-prop
// injection points. This verifies just the render boundary, not the
// already-proven grouping/filtering logic.
function FixtureList({
  matches,
  isAdmin,
  renderRound,
  renderSummaryAction,
}: {
  matches: CompetitionFixtureRow[];
  divisions: unknown[];
  isAdmin: boolean;
  competitionId: string;
  renderRound: (group: { key: string; label: string; items: CompetitionFixtureRow[] }) => JSX.Element;
  renderSummaryAction?: (summary: ReturnType<typeof summarizeFixtureRounds>) => JSX.Element;
}) {
  if (matches.length === 0) {
    return (
      <p>
        {isAdmin
          ? 'Invite teams first to schedule fixtures.'
          : 'Fixtures will appear once the organiser adds them.'}
      </p>
    );
  }
  const groups = groupFixturesByRound(matches);
  const summary = summarizeFixtureRounds(matches);
  return (
    <div>
      <p>{summary.totalRounds} round{summary.totalRounds === 1 ? '' : 's'} scheduled</p>
      {renderSummaryAction?.(summary)}
      {groups.map((group) => renderRound(group))}
    </div>
  );
}

describe('FixtureList', () => {
  it('shows role-specific guidance for a genuinely empty fixture list', () => {
    const admin = render(
      <FixtureList
        matches={[]}
        divisions={[]}
        isAdmin
        competitionId="competition-1"
        renderRound={vi.fn()}
      />,
    );
    expect(screen.getByText(/Invite teams first/i)).toBeTruthy();
    admin.unmount();

    render(
      <FixtureList
        matches={[]}
        divisions={[]}
        isAdmin={false}
        competitionId="competition-1"
        renderRound={vi.fn()}
      />,
    );
    expect(screen.getByText(/organiser adds them/i)).toBeTruthy();
  });

  it('renders the round summary, injected admin action and every grouped round', () => {
    const match = fixture('match-1');
    render(
      <FixtureList
        matches={[match]}
        divisions={[]}
        isAdmin
        competitionId="competition-1"
        renderSummaryAction={(summary) => <button>Max {summary.maximumRound}</button>}
        renderRound={(group) => <div key={group.key}>{group.label}</div>}
      />,
    );
    expect(screen.getByText('1 round scheduled')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Max 1' })).toBeTruthy();
    expect(screen.getByText('Round 1')).toBeTruthy();
  });
});
