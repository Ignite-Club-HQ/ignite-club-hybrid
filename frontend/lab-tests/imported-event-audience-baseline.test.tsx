import { expect, test } from 'vitest';
import {
  eventTargetTeamKey,
  getEventEligibleTeamIds,
  isMiniLeagueEvent,
} from '../src/lab/eventAudience';

test('preserves single-team audience precedence', () => {
  expect(getEventEligibleTeamIds({
    team_id: 'team-primary',
    target_team_ids: ['team-target'],
  })).toEqual(['team-primary']);
});

test('preserves targeted-team audience selection', () => {
  expect(getEventEligibleTeamIds({
    team_id: null,
    target_team_ids: ['team-a', 'team-b'],
  })).toEqual(['team-a', 'team-b']);
});

test('represents a genuinely club-wide event without a team filter', () => {
  expect(getEventEligibleTeamIds({ team_id: null, target_team_ids: [] })).toBeNull();
  expect(getEventEligibleTeamIds(undefined)).toBeNull();
});

test('keeps mini-league events on their separate audience path', () => {
  expect(isMiniLeagueEvent({ mini_league_id: 'league-1' })).toBe(true);
  expect(isMiniLeagueEvent({ mini_league_id: null })).toBe(false);
});

test('creates an order-independent targeted-team cache key', () => {
  expect(eventTargetTeamKey({ target_team_ids: ['team-b', 'team-a'] }))
    .toBe('team-a,team-b');
  expect(eventTargetTeamKey({ target_team_ids: ['team-a', 'team-b'] }))
    .toBe(eventTargetTeamKey({ target_team_ids: ['team-b', 'team-a'] }));
});
