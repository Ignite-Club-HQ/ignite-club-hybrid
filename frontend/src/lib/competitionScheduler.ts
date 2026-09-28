// Round-robin scheduler that respects per-division allowed weekdays,
// a daily time window, and a shared pitch pool. Pure functions only.

import { addDays, addMonths } from "date-fns";

export type Frequency = "weekly" | "biweekly" | "triweekly" | "monthly" | "custom";
export type SchedulingMode = "simultaneous" | "stagger";

export interface Pairing {
  round: number;
  home: string;
  away: string;
}

export interface PlacedFixture {
  round: number;
  home: string | null;
  away: string | null;
  /** Optional display label for placeholder/TBD slots (e.g. "1st seed"). */
  homeLabel?: string;
  awayLabel?: string;
  scheduledAt: Date | null;
  pitch: string | null;
  /** Optional note saved to the match (e.g. "Grand Final"). */
  note?: string;
}

export interface OccupiedSlot {
  /** minutes from midnight local */
  startMins: number;
  /** minutes from midnight local */
  endMins: number;
  pitch: string;
}

export interface SchedulerInput {
  pairings: Pairing[];
  /** ISO yyyy-mm-dd; the earliest date the first round may land on */
  startDate: Date | null;
  /** Inclusive end date or null for no cap */
  endDate: Date | null;
  /** 0..6 (Sun..Sat). Empty array = any weekday allowed. */
  allowedWeekdays: number[];
  /** minutes from midnight, e.g. 9:00 -> 540 */
  dayStartMins: number;
  /** minutes from midnight, e.g. 16:00 -> 960 */
  dayEndMins: number;
  /** per-match duration in minutes (includes any changeover gap the user wants) */
  durationMins: number;
  /** Total pitches in shared pool */
  pitchCount: number;
  pitchLabels: string[];
  frequency: Frequency;
  customDays: number;
  mode: SchedulingMode;
  /** Existing bookings on the shared pool, keyed yyyy-mm-dd (local). */
  occupiedByDate: Map<string, OccupiedSlot[]>;
  /** Optional admin overrides per round → yyyy-mm-dd. */
  roundDateOverrides?: Map<number, string>;
}

// ---------- helpers ----------

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function advanceByFrequency(d: Date, freq: Frequency, customDays: number): Date {
  switch (freq) {
    case "weekly": return addDays(d, 7);
    case "biweekly": return addDays(d, 14);
    case "triweekly": return addDays(d, 21);
    case "monthly": return addMonths(d, 1);
    case "custom": return addDays(d, Math.max(1, customDays));
  }
}

/** Snap forward to the next allowed weekday (inclusive of `d`). */
export function snapToAllowedWeekday(d: Date, allowed: number[]): Date {
  if (!allowed.length) return d;
  const out = new Date(d);
  for (let i = 0; i < 8; i++) {
    if (allowed.includes(out.getDay())) return out;
    out.setDate(out.getDate() + 1);
  }
  return d;
}

/** Next allowed weekday strictly after `d`. */
export function nextAllowedDay(d: Date, allowed: number[]): Date {
  const next = addDays(d, 1);
  return snapToAllowedWeekday(next, allowed.length ? allowed : [0,1,2,3,4,5,6]);
}

function setTimeOfDay(d: Date, mins: number): Date {
  const out = new Date(d);
  out.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return out;
}

/** Build round-robin pairings (circle method) with home/away alternating. */
export function buildRoundRobinPairings(teamIds: string[]): Pairing[] {
  const teams = [...teamIds];
  if (teams.length < 2) return [];
  if (teams.length % 2 === 1) teams.push("__BYE__");
  const n = teams.length;
  const rounds = n - 1;
  const half = n / 2;
  const fixtures: Pairing[] = [];
  let arr = [...teams];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "__BYE__" && b !== "__BYE__") {
        if (r % 2 === 0) fixtures.push({ round: r + 1, home: a, away: b });
        else fixtures.push({ round: r + 1, home: b, away: a });
      }
    }
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return fixtures;
}

// ---------- scheduling pass ----------

export interface SchedulerOutput {
  placed: PlacedFixture[];
  /** Rounds that overflowed their starting day onto subsequent allowed days */
  overflowRounds: number[];
  /** Rounds that needed extra same-day waves (simultaneous mode only). */
  extraWaveRounds: number[];
  /** Matches that could not be scheduled at all (window/end date too tight) */
  unscheduled: Pairing[];
  /** Per-round summary: { round, dates: string[], dayUsed: number } */
  roundSummaries: { round: number; dates: string[]; matchCount: number }[];
}

/**
 * Pack `pairings` into the calendar respecting weekdays, day window, pitch
 * pool, and existing occupied slots. Mutates a *local copy* of occupiedByDate.
 */
export function scheduleFixtures(input: SchedulerInput): SchedulerOutput {
  const {
    pairings, startDate, endDate, allowedWeekdays,
    dayStartMins, dayEndMins, durationMins, pitchCount,
    pitchLabels, frequency, customDays, mode,
    occupiedByDate, roundDateOverrides,
  } = input;

  // Local mutable copy of shared pool
  const pool = new Map<string, OccupiedSlot[]>();
  occupiedByDate.forEach((v, k) => pool.set(k, [...v]));

  const allowed = allowedWeekdays.length ? [...allowedWeekdays].sort() : [];
  const dur = Math.max(1, durationMins || 60);
  const placed: PlacedFixture[] = [];
  const overflowRounds = new Set<number>();
  const extraWaveRounds = new Set<number>();
  const unscheduled: Pairing[] = [];

  // Group pairings by round
  const byRound = new Map<number, Pairing[]>();
  for (const p of pairings) {
    if (!byRound.has(p.round)) byRound.set(p.round, []);
    byRound.get(p.round)!.push(p);
  }
  const roundsList = Array.from(byRound.keys()).sort((a, b) => a - b);

  // Decide target first-day for each round
  const roundFirstDate = new Map<number, Date | null>();
  let prev: Date | null = null;
  for (const r of roundsList) {
    let target: Date | null;
    const override = roundDateOverrides?.get(r);
    if (override) {
      target = new Date(`${override}T00:00:00`);
    } else if (!startDate) {
      target = null;
    } else if (prev) {
      const advanced = advanceByFrequency(prev, frequency, customDays);
      target = snapToAllowedWeekday(advanced, allowed);
    } else {
      target = snapToAllowedWeekday(new Date(startDate), allowed);
    }
    roundFirstDate.set(r, target);
    if (target) prev = target;
  }

  const roundSummaries: SchedulerOutput["roundSummaries"] = [];

  for (const r of roundsList) {
    const matches = byRound.get(r)!;
    const target = roundFirstDate.get(r) ?? null;

    // If no date, just emit placeholder rows with no time/pitch
    if (!target) {
      for (const m of matches) {
        placed.push({ round: r, home: m.home, away: m.away, scheduledAt: null, pitch: null });
      }
      roundSummaries.push({ round: r, dates: [], matchCount: matches.length });
      continue;
    }

    // Place matches across consecutive allowed days starting at `target`
    const datesUsed: string[] = [];
    let day = new Date(target);
    let remaining = [...matches];
    let safety = 60; // up to 60 day-shifts per round

    while (remaining.length > 0 && safety-- > 0) {
      // Respect end date
      if (endDate && day.getTime() > endDate.getTime()) {
        unscheduled.push(...remaining);
        remaining = [];
        break;
      }

      const key = dateKey(day);
      const existing = pool.get(key) ?? [];
      datesUsed.push(key);

      // Build timeslots. Both modes generate waves through the day window so
      // overflow stays same-day before rolling to the next allowed day. In
      // "simultaneous" mode we still track when extra waves are used so the
      // caller can confirm with the user.
      const slots: number[] = [];
      for (let t = dayStartMins; t + dur <= dayEndMins; t += dur) slots.push(t);
      if (slots.length === 0) slots.push(dayStartMins); // window too tight: at least one
      let wavesUsedThisDay = 0;

      for (const slotStart of slots) {
        if (remaining.length === 0) break;
        const slotEnd = slotStart + dur;
        // Which pitches are free in this slot?
        const taken = new Set<string>();
        for (const o of existing) {
          if (o.startMins < slotEnd && o.endMins > slotStart) taken.add(o.pitch);
        }
        const freePitches = pitchLabels.filter((p) => !taken.has(p));
        if (freePitches.length === 0) continue;

        const take = Math.min(freePitches.length, remaining.length);
        for (let i = 0; i < take; i++) {
          const m = remaining.shift()!;
          const pitch = freePitches[i];
          const scheduledAt = setTimeOfDay(day, slotStart);
          placed.push({
            round: r,
            home: m.home,
            away: m.away,
            scheduledAt,
            pitch: pitchCount > 0 ? pitch : null,
          });
          // Update pool so subsequent rounds/divisions see this booking
          existing.push({ startMins: slotStart, endMins: slotEnd, pitch });
        }
        wavesUsedThisDay += 1;
        if (mode === "simultaneous" && wavesUsedThisDay > 1) {
          extraWaveRounds.add(r);
        }
      }
      pool.set(key, existing);

      if (remaining.length > 0) {
        overflowRounds.add(r);
        // Roll to next allowed weekday (do not wait for full frequency gap;
        // overflow is "extra days in same round")
        day = nextAllowedDay(day, allowed);
      }
    }

    roundSummaries.push({ round: r, dates: datesUsed, matchCount: matches.length });
  }

  return {
    placed,
    overflowRounds: Array.from(overflowRounds).sort((a, b) => a - b),
    extraWaveRounds: Array.from(extraWaveRounds).sort((a, b) => a - b),
    unscheduled,
    roundSummaries,
  };
}

// ---------- input helpers ----------

export function parseTimeToMins(hhmm: string, fallback: number): number {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return fallback;
  const [h, m] = hhmm.split(":").map(Number);
  return Math.min(24 * 60, Math.max(0, h * 60 + m));
}

export function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------- finals helpers ----------

export type FinalsFormat = "gf" | "top4" | "top6" | "top8";

/** Seed pairings for the finals round: 1v2, 3v4, 5v6, 7v8. */
export function buildFinalsSeedPairings(format: FinalsFormat): { homeSeed: number; awaySeed: number; isGrandFinal: boolean }[] {
  const pairs: { homeSeed: number; awaySeed: number; isGrandFinal: boolean }[] = [
    { homeSeed: 1, awaySeed: 2, isGrandFinal: true },
  ];
  if (format === "top4" || format === "top6" || format === "top8") {
    pairs.push({ homeSeed: 3, awaySeed: 4, isGrandFinal: false });
  }
  if (format === "top6" || format === "top8") {
    pairs.push({ homeSeed: 5, awaySeed: 6, isGrandFinal: false });
  }
  if (format === "top8") {
    pairs.push({ homeSeed: 7, awaySeed: 8, isGrandFinal: false });
  }
  return pairs;
}

/**
 * Place finals fixtures (with placeholder/TBD teams) on the next allowed
 * weekday strictly after `afterDate`. Spreads across the shared pitch pool.
 */
export function placeFinalsFixtures(opts: {
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
  const { round, format, afterDate, allowedWeekdays, dayStartMins, dayEndMins, durationMins, pitchLabels, occupiedByDate } = opts;
  const allowed = allowedWeekdays.length ? allowedWeekdays : [0,1,2,3,4,5,6];
  const dur = Math.max(1, durationMins || 60);
  const pairs = buildFinalsSeedPairings(format);

  // Start strictly after the last regular date
  let day = nextAllowedDay(afterDate, allowed);
  const placed: PlacedFixture[] = [];
  let remaining = [...pairs];
  let safety = 60;

  while (remaining.length > 0 && safety-- > 0) {
    const key = dateKey(day);
    const existing = occupiedByDate.get(key) ?? [];
    const slots: number[] = [];
    for (let t = dayStartMins; t + dur <= dayEndMins; t += dur) slots.push(t);
    if (slots.length === 0) slots.push(dayStartMins);

    for (const slotStart of slots) {
      if (remaining.length === 0) break;
      const slotEnd = slotStart + dur;
      const taken = new Set<string>();
      for (const o of existing) {
        if (o.startMins < slotEnd && o.endMins > slotStart) taken.add(o.pitch);
      }
      const freePitches = pitchLabels.filter((p) => !taken.has(p));
      if (freePitches.length === 0) continue;
      const take = Math.min(freePitches.length, remaining.length);
      for (let i = 0; i < take; i++) {
        const pair = remaining.shift()!;
        const pitch = freePitches[i];
        const scheduledAt = new Date(day);
        scheduledAt.setHours(Math.floor(slotStart / 60), slotStart % 60, 0, 0);
        placed.push({
          round,
          home: null,
          away: null,
          homeLabel: `${ordinal(pair.homeSeed)} seed`,
          awayLabel: `${ordinal(pair.awaySeed)} seed`,
          scheduledAt,
          pitch: pitchLabels.length > 0 ? pitch : null,
          note: pair.isGrandFinal
            ? `Grand Final · ${pair.homeSeed} v ${pair.awaySeed}`
            : `Finals · ${pair.homeSeed} v ${pair.awaySeed}`,
        });
        existing.push({ startMins: slotStart, endMins: slotEnd, pitch });
      }
    }
    occupiedByDate.set(key, existing);
    if (remaining.length > 0) day = nextAllowedDay(day, allowed);
  }
  return placed;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
