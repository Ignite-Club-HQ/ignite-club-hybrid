import { describe, expect, it } from 'vitest';
import {
  groupFixturesByRound,
  summarizeFixtureRounds,
} from '../src/features/competitions/fixtures/fixtureListModel';

function match(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    competition_id: 'competition-1',
    status: 'scheduled',
    ...overrides,
  };
}

describe('ported fixture round section use cases', () => {
  it('provides round sections with stable labels, rows and completion state', () => {
    const items = [
      match('match-1', {
        round_number: 1,
        scheduled_at: '2026-08-03T09:00:00Z',
        status: 'completed',
      }),
      match('match-2', {
        round_number: 1,
        scheduled_at: '2026-08-10T09:00:00Z',
      }),
    ];
    const section = groupFixturesByRound(items)[0];
    const completed = section.items.filter((item) => item.status === 'completed').length;

    expect(section).toMatchObject({
      key: 'r1',
      label: 'Round 1',
    });
    expect(section.items.map((item) => item.id)).toEqual(['match-1', 'match-2']);
    expect(`${completed}/${section.items.length} Complete`).toBe('1/2 Complete');
  });

  it('preserves unscheduled rows in an Other matches section without inventing a date range', () => {
    const section = groupFixturesByRound([
      match('unscheduled-1'),
      match('unscheduled-2', { scheduled_at: null }),
    ])[0];

    expect(section).toMatchObject({ key: 'unscheduled', label: 'Other matches' });
    expect(section.items.map((item) => item.id)).toEqual(['unscheduled-1', 'unscheduled-2']);
    expect(summarizeFixtureRounds(section.items)).toEqual({
      roundNumbers: [],
      totalRounds: 0,
      maximumRound: 0,
    });
  });

  it('keeps separate sections in first-seen order while retaining each match row', () => {
    const groups = groupFixturesByRound([
      match('round-two', { round_number: 2 }),
      match('round-one', { round_number: 1 }),
      match('round-two-again', { round_number: 2 }),
    ]);

    expect(groups.map((group) => ({
      label: group.label,
      ids: group.items.map((item) => item.id),
    }))).toEqual([
      { label: 'Round 2', ids: ['round-two', 'round-two-again'] },
      { label: 'Round 1', ids: ['round-one'] },
    ]);
  });
});
