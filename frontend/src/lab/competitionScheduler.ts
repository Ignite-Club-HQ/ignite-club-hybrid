import { addDays, addMonths } from 'date-fns';

export type Frequency = 'weekly' | 'biweekly' | 'triweekly' | 'monthly' | 'custom';

export interface Pairing {
  round: number;
  home: string;
  away: string;
}

export type SchedulingMode = 'simultaneous' | 'stagger';

export interface PlacedFixture {
  round: number;
  home: string | null;
  away: string | null;
  homeLabel?: string;
  awayLabel?: string;
  scheduledAt: Date | null;
  pitch: string | null;
  note?: string;
}

export interface OccupiedSlot {
  startMins: number;
  endMins: number;
  pitch: string;
}

export interface SchedulerInput {
  pairings: Pairing[];
  startDate: Date | null;
  endDate: Date | null;
  allowedWeekdays: number[];
  dayStartMins: number;
  dayEndMins: number;
  durationMins: number;
  pitchCount: number;
  pitchLabels: string[];
  frequency: Frequency;
  customDays: number;
  mode: SchedulingMode;
  occupiedByDate: Map<string, OccupiedSlot[]>;
  roundDateOverrides?: Map<number, string>;
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function advanceByFrequency(
  date: Date,
  frequency: Frequency,
  customDays: number,
): Date {
  switch (frequency) {
    case 'weekly':
      return addDays(date, 7);
    case 'biweekly':
      return addDays(date, 14);
    case 'triweekly':
      return addDays(date, 21);
    case 'monthly':
      return addMonths(date, 1);
    case 'custom':
      return addDays(date, Math.max(1, customDays));
  }
}

/** Snap forward to the next allowed weekday, including the current date. */
export function snapToAllowedWeekday(date: Date, allowedWeekdays: number[]): Date {
  if (allowedWeekdays.length === 0) return new Date(date);

  const result = new Date(date);
  for (let offset = 0; offset <= 7; offset += 1) {
    if (allowedWeekdays.includes(result.getDay())) return result;
    result.setDate(result.getDate() + 1);
  }
  return new Date(date);
}

/** Return the next allowed weekday strictly after the supplied date. */
export function nextAllowedDay(date: Date, allowedWeekdays: number[]): Date {
  const next = addDays(date, 1);
  return snapToAllowedWeekday(
    next,
    allowedWeekdays.length ? allowedWeekdays : [0, 1, 2, 3, 4, 5, 6],
  );
}

/**
 * Build round-robin pairings with the circle method and alternating home/away
 * assignment. Odd-sized competitions receive a bye and no bye fixture.
 */
export function buildRoundRobinPairings(teamIds: string[]): Pairing[] {
  const teams = [...teamIds];
  if (teams.length < 2) return [];
  if (teams.length % 2 === 1) teams.push('__BYE__');

  const roundCount = teams.length - 1;
  const half = teams.length / 2;
  const pairings: Pairing[] = [];
  let rotation = [...teams];

  for (let round = 0; round < roundCount; round += 1) {
    for (let index = 0; index < half; index += 1) {
      const first = rotation[index];
      const second = rotation[rotation.length - 1 - index];
      if (first === '__BYE__' || second === '__BYE__') continue;

      pairings.push(round % 2 === 0
        ? { round: round + 1, home: first, away: second }
        : { round: round + 1, home: second, away: first });
    }
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)];
  }

  return pairings;
}

function setTimeOfDay(date: Date, minutes: number): Date {
  const result = new Date(date);
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return result;
}

export interface SchedulerOutput {
  placed: PlacedFixture[];
  overflowRounds: number[];
  extraWaveRounds: number[];
  unscheduled: Pairing[];
  roundSummaries: { round: number; dates: string[]; matchCount: number }[];
}

/**
 * Pack pairings into the calendar without mutating the caller's occupied slots.
 * Each round can use later waves on its starting day before moving to the next
 * allowed weekday, while later rounds retain their configured frequency.
 */
export function scheduleFixtures(input: SchedulerInput): SchedulerOutput {
  const {
    pairings,
    startDate,
    endDate,
    allowedWeekdays,
    dayStartMins,
    dayEndMins,
    durationMins,
    pitchCount,
    pitchLabels,
    frequency,
    customDays,
    mode,
    occupiedByDate,
    roundDateOverrides,
  } = input;
  const pool = new Map<string, OccupiedSlot[]>();
  occupiedByDate.forEach((slots, key) => pool.set(key, [...slots]));
  const allowed = allowedWeekdays.length ? [...allowedWeekdays].sort() : [];
  const duration = Math.max(1, durationMins || 60);
  const placed: PlacedFixture[] = [];
  const overflowRounds = new Set<number>();
  const extraWaveRounds = new Set<number>();
  const unscheduled: Pairing[] = [];
  const byRound = new Map<number, Pairing[]>();

  for (const pairing of pairings) {
    const round = byRound.get(pairing.round) ?? [];
    round.push(pairing);
    byRound.set(pairing.round, round);
  }

  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  const firstDateByRound = new Map<number, Date | null>();
  let previousDate: Date | null = null;

  for (const round of rounds) {
    const override = roundDateOverrides?.get(round);
    let target: Date | null;
    if (override) {
      target = new Date(`${override}T00:00:00`);
    } else if (!startDate) {
      target = null;
    } else if (previousDate) {
      target = snapToAllowedWeekday(
        advanceByFrequency(previousDate, frequency, customDays),
        allowed,
      );
    } else {
      target = snapToAllowedWeekday(new Date(startDate), allowed);
    }
    firstDateByRound.set(round, target);
    if (target) previousDate = target;
  }

  const roundSummaries: SchedulerOutput['roundSummaries'] = [];
  for (const round of rounds) {
    const matches = byRound.get(round) ?? [];
    const target = firstDateByRound.get(round) ?? null;
    if (!target) {
      placed.push(...matches.map((match) => ({
        round,
        home: match.home,
        away: match.away,
        scheduledAt: null,
        pitch: null,
      })));
      roundSummaries.push({ round, dates: [], matchCount: matches.length });
      continue;
    }

    const datesUsed: string[] = [];
    let day = new Date(target);
    let remaining = [...matches];
    let safety = 60;

    while (remaining.length > 0 && safety-- > 0) {
      if (endDate && day.getTime() > endDate.getTime()) {
        unscheduled.push(...remaining);
        remaining = [];
        break;
      }

      const key = dateKey(day);
      const existing = pool.get(key) ?? [];
      datesUsed.push(key);
      const slots: number[] = [];
      for (let time = dayStartMins; time + duration <= dayEndMins; time += duration) {
        slots.push(time);
      }
      if (slots.length === 0) slots.push(dayStartMins);
      let wavesUsed = 0;

      for (const slotStart of slots) {
        if (remaining.length === 0) break;
        const slotEnd = slotStart + duration;
        const taken = new Set(
          existing
            .filter((slot) => slot.startMins < slotEnd && slot.endMins > slotStart)
            .map((slot) => slot.pitch),
        );
        const freePitches = pitchLabels.filter((pitch) => !taken.has(pitch));
        if (freePitches.length === 0) continue;

        const count = Math.min(freePitches.length, remaining.length);
        for (let index = 0; index < count; index += 1) {
          const match = remaining.shift()!;
          const pitch = freePitches[index];
          placed.push({
            round,
            home: match.home,
            away: match.away,
            scheduledAt: setTimeOfDay(day, slotStart),
            pitch: pitchCount > 0 ? pitch : null,
          });
          existing.push({ startMins: slotStart, endMins: slotEnd, pitch });
        }
        wavesUsed += 1;
        if (mode === 'simultaneous' && wavesUsed > 1) extraWaveRounds.add(round);
      }
      pool.set(key, existing);

      if (remaining.length > 0) {
        overflowRounds.add(round);
        day = nextAllowedDay(day, allowed);
      }
    }
    roundSummaries.push({ round, dates: datesUsed, matchCount: matches.length });
  }

  return {
    placed,
    overflowRounds: [...overflowRounds].sort((a, b) => a - b),
    extraWaveRounds: [...extraWaveRounds].sort((a, b) => a - b),
    unscheduled,
    roundSummaries,
  };
}

export function parseTimeToMins(value: string, fallback: number): number {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return fallback;
  const [hours, minutes] = value.split(':').map(Number);
  return Math.min(24 * 60, Math.max(0, hours * 60 + minutes));
}

export function minsToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export type FinalsFormat = 'gf' | 'top4' | 'top6' | 'top8';

export interface FinalsSeedPairing {
  homeSeed: number;
  awaySeed: number;
  isGrandFinal: boolean;
}

export function buildFinalsSeedPairings(format: FinalsFormat): FinalsSeedPairing[] {
  const pairs: FinalsSeedPairing[] = [{ homeSeed: 1, awaySeed: 2, isGrandFinal: true }];
  if (format === 'top4' || format === 'top6' || format === 'top8') {
    pairs.push({ homeSeed: 3, awaySeed: 4, isGrandFinal: false });
  }
  if (format === 'top6' || format === 'top8') {
    pairs.push({ homeSeed: 5, awaySeed: 6, isGrandFinal: false });
  }
  if (format === 'top8') {
    pairs.push({ homeSeed: 7, awaySeed: 8, isGrandFinal: false });
  }
  return pairs;
}

export function placeFinalsFixtures(options: {
  round: number;
  format: FinalsFormat;
  afterDate: Date;
  allowedWeekdays: number[];
  dayStartMins: number;
  dayEndMins: number;
  durationMins: number;
  pitchLabels: string[];
  occupiedByDate: Map<string, OccupiedSlot[]>;
}): PlacedFixture[] {
  const {
    round,
    format,
    afterDate,
    allowedWeekdays,
    dayStartMins,
    dayEndMins,
    durationMins,
    pitchLabels,
    occupiedByDate,
  } = options;
  const allowed = allowedWeekdays.length ? allowedWeekdays : [0, 1, 2, 3, 4, 5, 6];
  const duration = Math.max(1, durationMins || 60);
  const remaining = buildFinalsSeedPairings(format);
  const placed: PlacedFixture[] = [];
  let day = nextAllowedDay(afterDate, allowed);
  let safety = 60;

  while (remaining.length > 0 && safety-- > 0) {
    const key = dateKey(day);
    const existing = occupiedByDate.get(key) ?? [];
    const slots: number[] = [];
    for (let time = dayStartMins; time + duration <= dayEndMins; time += duration) {
      slots.push(time);
    }
    if (slots.length === 0) slots.push(dayStartMins);

    for (const slotStart of slots) {
      if (remaining.length === 0) break;
      const slotEnd = slotStart + duration;
      const taken = new Set(
        existing
          .filter((slot) => slot.startMins < slotEnd && slot.endMins > slotStart)
          .map((slot) => slot.pitch),
      );
      const freePitches = pitchLabels.filter((pitch) => !taken.has(pitch));
      const count = Math.min(freePitches.length, remaining.length);
      for (let index = 0; index < count; index += 1) {
        const seedPair = remaining.shift()!;
        const pitch = freePitches[index];
        placed.push({
          round,
          home: null,
          away: null,
          homeLabel: `${ordinal(seedPair.homeSeed)} seed`,
          awayLabel: `${ordinal(seedPair.awaySeed)} seed`,
          scheduledAt: setTimeOfDay(day, slotStart),
          pitch,
          note: seedPair.isGrandFinal
            ? `Grand Final - ${seedPair.homeSeed} v ${seedPair.awaySeed}`
            : `Finals - ${seedPair.homeSeed} v ${seedPair.awaySeed}`,
        });
        existing.push({ startMins: slotStart, endMins: slotEnd, pitch });
      }
    }
    occupiedByDate.set(key, existing);
    if (remaining.length > 0) day = nextAllowedDay(day, allowed);
  }
  return placed;
}

function ordinal(value: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const mod = value % 100;
  return value + (suffixes[(mod - 20) % 10] || suffixes[mod] || suffixes[0]);
}
