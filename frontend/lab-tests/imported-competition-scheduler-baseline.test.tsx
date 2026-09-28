import { expect, test } from 'vitest';
import {
  advanceByFrequency,
  buildFinalsSeedPairings,
  buildRoundRobinPairings,
  dateKey,
  minsToTime,
  nextAllowedDay,
  parseTimeToMins,
  placeFinalsFixtures,
  scheduleFixtures,
  snapToAllowedWeekday,
  type Pairing,
  type SchedulerInput,
} from '../src/lab/competitionScheduler';

test('builds deterministic round-robin pairings without bye fixtures', () => {
  const pairings = buildRoundRobinPairings(['team-a', 'team-b', 'team-c', 'team-d']);

  expect(pairings).toHaveLength(6);
  expect(pairings).toEqual(buildRoundRobinPairings(['team-a', 'team-b', 'team-c', 'team-d']));
  expect(new Set(pairings.map(pair => [pair.home, pair.away].sort().join(':'))).size).toBe(6);
  expect(pairings.every(pair => pair.home !== pair.away)).toBe(true);
});

test('adds an odd-team bye without emitting a placeholder fixture', () => {
  const pairings = buildRoundRobinPairings(['team-a', 'team-b', 'team-c']);

  expect(pairings).toHaveLength(3);
  expect(pairings.every(pair => !pair.home.includes('BYE') && !pair.away.includes('BYE'))).toBe(true);
});

test('alternates home and away assignment by round', () => {
  const pairings = buildRoundRobinPairings(['team-a', 'team-b', 'team-c', 'team-d']);
  const firstRound = pairings.filter(pair => pair.round === 1);
  const secondRound = pairings.filter(pair => pair.round === 2);

  expect(firstRound).toEqual([
    { round: 1, home: 'team-a', away: 'team-d' },
    { round: 1, home: 'team-b', away: 'team-c' },
  ]);
  expect(secondRound).toEqual([
    { round: 2, home: 'team-c', away: 'team-a' },
    { round: 2, home: 'team-b', away: 'team-d' },
  ]);
});

test('advances supported competition frequencies without mutating the input date', () => {
  const date = new Date(2026, 0, 31);

  expect(dateKey(advanceByFrequency(date, 'weekly', 0))).toBe('2026-02-07');
  expect(dateKey(advanceByFrequency(date, 'biweekly', 0))).toBe('2026-02-14');
  expect(dateKey(advanceByFrequency(date, 'triweekly', 0))).toBe('2026-02-21');
  expect(dateKey(advanceByFrequency(date, 'monthly', 0))).toBe('2026-02-28');
  expect(dateKey(advanceByFrequency(date, 'custom', 0))).toBe('2026-02-01');
  expect(dateKey(date)).toBe('2026-01-31');
});

test('snaps to allowed weekdays and advances strictly after the current day', () => {
  const saturday = new Date(2026, 0, 3);

  expect(dateKey(snapToAllowedWeekday(saturday, [1]))).toBe('2026-01-05');
  expect(dateKey(snapToAllowedWeekday(saturday, []))).toBe('2026-01-03');
  expect(dateKey(nextAllowedDay(saturday, [6]))).toBe('2026-01-10');
});

function baseInput(pairings: Pairing[]): SchedulerInput {
  return {
    pairings,
    startDate: new Date(2026, 7, 1),
    endDate: null,
    allowedWeekdays: [6],
    dayStartMins: 9 * 60,
    dayEndMins: 12 * 60,
    durationMins: 60,
    pitchCount: 2,
    pitchLabels: ['Pitch 1', 'Pitch 2'],
    frequency: 'weekly',
    customDays: 7,
    mode: 'simultaneous',
    occupiedByDate: new Map(),
  };
}

test('packs same-day waves across distinct pitches and preserves occupied slots', () => {
  const input = baseInput([
    { round: 1, home: 'A', away: 'B' },
    { round: 1, home: 'C', away: 'D' },
    { round: 1, home: 'E', away: 'F' },
  ]);
  input.occupiedByDate.set('2026-08-01', [
    { startMins: 9 * 60, endMins: 10 * 60, pitch: 'Pitch 1' },
  ]);

  const output = scheduleFixtures(input);

  expect(output.placed.map((fixture) => fixture.pitch)).toEqual([
    'Pitch 2',
    'Pitch 1',
    'Pitch 2',
  ]);
  expect(output.placed.map((fixture) => fixture.scheduledAt?.getHours())).toEqual([9, 10, 10]);
  expect(output.extraWaveRounds).toEqual([1]);
  expect(input.occupiedByDate.get('2026-08-01')).toHaveLength(1);
});

test('overflows rounds and reports unscheduled matches at the end date', () => {
  const input = baseInput([
    { round: 1, home: 'A', away: 'B' },
    { round: 1, home: 'C', away: 'D' },
  ]);
  input.pitchCount = 1;
  input.pitchLabels = ['Only Pitch'];
  input.dayEndMins = 10 * 60;
  input.endDate = new Date(2026, 7, 1, 23, 59);

  const output = scheduleFixtures(input);

  expect(output.placed).toHaveLength(1);
  expect(output.unscheduled).toEqual([{ round: 1, home: 'C', away: 'D' }]);
  expect(output.overflowRounds).toEqual([1]);
});

test('supports deterministic date overrides and no-date placeholders', () => {
  const input = baseInput([
    { round: 2, home: 'A', away: 'C' },
    { round: 1, home: 'A', away: 'B' },
  ]);
  input.roundDateOverrides = new Map([[2, '2026-08-22']]);
  const output = scheduleFixtures(input);

  expect(output.placed.map((fixture) => dateKey(fixture.scheduledAt!))).toEqual([
    '2026-08-01',
    '2026-08-22',
  ]);

  input.startDate = null;
  const placeholders = scheduleFixtures(input);
  expect(placeholders.placed[0]).toMatchObject({
    round: 1,
    scheduledAt: null,
    pitch: null,
  });
});

test('parses and formats time boundaries and places finals after regular fixtures', () => {
  expect(parseTimeToMins('09:30', 600)).toBe(570);
  expect(parseTimeToMins('bad', 600)).toBe(600);
  expect(parseTimeToMins('99:99', 600)).toBe(1440);
  expect(minsToTime(570)).toBe('09:30');
  expect(buildFinalsSeedPairings('top8')).toHaveLength(4);

  const occupied = new Map([
    ['2026-08-08', [{ startMins: 540, endMins: 600, pitch: 'Pitch 1' }]],
  ]);
  const finals = placeFinalsFixtures({
    round: 4,
    format: 'gf',
    afterDate: new Date(2026, 7, 1),
    allowedWeekdays: [6],
    dayStartMins: 540,
    dayEndMins: 660,
    durationMins: 60,
    pitchLabels: ['Pitch 1', 'Pitch 2'],
    occupiedByDate: occupied,
  });

  expect(finals[0]).toMatchObject({
    homeLabel: '1st seed',
    awayLabel: '2nd seed',
    note: 'Grand Final - 1 v 2',
    pitch: 'Pitch 2',
  });
  expect(dateKey(finals[0].scheduledAt!)).toBe('2026-08-08');
});
