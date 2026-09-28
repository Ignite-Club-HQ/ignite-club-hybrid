import { describe, expect, it } from "vitest";

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
} from "./competitionScheduler";

function baseInput(pairings: Pairing[]): SchedulerInput {
  return {
    pairings,
    startDate: new Date("2026-08-01T00:00:00"),
    endDate: null,
    allowedWeekdays: [6],
    dayStartMins: 9 * 60,
    dayEndMins: 12 * 60,
    durationMins: 60,
    pitchCount: 2,
    pitchLabels: ["Pitch 1", "Pitch 2"],
    frequency: "weekly",
    customDays: 7,
    mode: "simultaneous",
    occupiedByDate: new Map(),
  };
}

describe("competition round-robin pairings", () => {
  it("creates every unique matchup exactly once for an even team count", () => {
    const fixtures = buildRoundRobinPairings(["A", "B", "C", "D"]);
    expect(fixtures).toHaveLength(6);
    expect(new Set(fixtures.map((f) => [f.home, f.away].sort().join("-"))).size).toBe(6);
    expect(new Set(fixtures.map((f) => f.round))).toEqual(new Set([1, 2, 3]));
    expect(fixtures.every((f) => f.home !== f.away)).toBe(true);
  });

  it("handles an odd team count with one bye per round and no fake fixtures", () => {
    const fixtures = buildRoundRobinPairings(["A", "B", "C"]);
    expect(fixtures).toHaveLength(3);
    expect(fixtures.some((f) => f.home === "__BYE__" || f.away === "__BYE__")).toBe(false);
    expect(new Set(fixtures.map((f) => f.round)).size).toBe(3);
  });

  it("returns no fixtures for fewer than two teams and does not mutate input", () => {
    const teams = ["A"];
    expect(buildRoundRobinPairings(teams)).toEqual([]);
    expect(teams).toEqual(["A"]);
  });
});

describe("competition fixture placement", () => {
  it("places simultaneous fixtures across distinct pitches at the same time", () => {
    const out = scheduleFixtures(baseInput([
      { round: 1, home: "A", away: "B" },
      { round: 1, home: "C", away: "D" },
    ]));
    expect(out.placed).toHaveLength(2);
    expect(out.placed[0].scheduledAt?.getTime()).toBe(out.placed[1].scheduledAt?.getTime());
    expect(new Set(out.placed.map((f) => f.pitch))).toEqual(new Set(["Pitch 1", "Pitch 2"]));
  });

  it("avoids occupied pitches and uses the remaining shared capacity", () => {
    const input = baseInput([{ round: 1, home: "A", away: "B" }]);
    input.occupiedByDate.set("2026-08-01", [{ startMins: 540, endMins: 600, pitch: "Pitch 1" }]);
    const out = scheduleFixtures(input);
    expect(out.placed[0]).toMatchObject({ pitch: "Pitch 2" });
    expect(out.placed[0].scheduledAt?.getHours()).toBe(9);
  });

  it("uses later same-day waves before overflowing to another day", () => {
    const input = baseInput([
      { round: 1, home: "A", away: "B" }, { round: 1, home: "C", away: "D" },
      { round: 1, home: "E", away: "F" },
    ]);
    const out = scheduleFixtures(input);
    expect(out.placed.map((f) => f.scheduledAt?.getHours())).toEqual([9, 9, 10]);
    expect(out.extraWaveRounds).toEqual([1]);
    expect(out.overflowRounds).toEqual([]);
  });

  it("overflows to the next allowed weekday when the daily window is full", () => {
    const input = baseInput([
      { round: 1, home: "A", away: "B" }, { round: 1, home: "C", away: "D" },
    ]);
    input.pitchLabels = ["Only Pitch"]; input.pitchCount = 1; input.dayEndMins = 600;
    const out = scheduleFixtures(input);
    expect(out.placed.map((f) => dateKey(f.scheduledAt!))).toEqual(["2026-08-01", "2026-08-08"]);
    expect(out.overflowRounds).toEqual([1]);
  });

  it("reports remaining fixtures as unscheduled when overflow exceeds the end date", () => {
    const input = baseInput([
      { round: 1, home: "A", away: "B" }, { round: 1, home: "C", away: "D" },
    ]);
    input.pitchLabels = ["Only Pitch"]; input.pitchCount = 1; input.dayEndMins = 600;
    input.endDate = new Date("2026-08-01T23:59:59");
    const out = scheduleFixtures(input);
    expect(out.placed).toHaveLength(1);
    expect(out.unscheduled).toEqual([{ round: 1, home: "C", away: "D" }]);
  });

  it("creates unscheduled placeholders when no start date is provided", () => {
    const input = baseInput([{ round: 1, home: "A", away: "B" }]);
    input.startDate = null;
    const out = scheduleFixtures(input);
    expect(out.placed).toEqual([{ round: 1, home: "A", away: "B", scheduledAt: null, pitch: null }]);
    expect(out.unscheduled).toEqual([]);
  });

  it("honours per-round date overrides without changing other rounds", () => {
    const input = baseInput([
      { round: 1, home: "A", away: "B" }, { round: 2, home: "A", away: "C" },
    ]);
    input.roundDateOverrides = new Map([[2, "2026-08-22"]]);
    const out = scheduleFixtures(input);
    expect(out.placed.map((f) => dateKey(f.scheduledAt!))).toEqual(["2026-08-01", "2026-08-22"]);
  });

  it("does not mutate the caller's occupied-slot map", () => {
    const input = baseInput([{ round: 1, home: "A", away: "B" }]);
    const existing = [{ startMins: 480, endMins: 540, pitch: "Pitch 1" }];
    input.occupiedByDate.set("2026-08-01", existing);
    scheduleFixtures(input);
    expect(existing).toEqual([{ startMins: 480, endMins: 540, pitch: "Pitch 1" }]);
  });

  it("treats adjacent occupied slots as non-overlapping", () => {
    const input = baseInput([{ round: 1, home: "A", away: "B" }]);
    input.occupiedByDate.set("2026-08-01", [
      { startMins: 480, endMins: 540, pitch: "Pitch 1" },
      { startMins: 600, endMins: 660, pitch: "Pitch 2" },
    ]);

    const out = scheduleFixtures(input);
    expect(out.placed[0]).toMatchObject({ pitch: "Pitch 1" });
    expect(out.placed[0].scheduledAt?.getHours()).toBe(9);
  });

  it("sorts out-of-order round input before applying frequency spacing", () => {
    const input = baseInput([
      { round: 3, home: "A", away: "D" },
      { round: 1, home: "A", away: "B" },
      { round: 2, home: "A", away: "C" },
    ]);

    const out = scheduleFixtures(input);
    expect(out.placed.map((fixture) => fixture.round)).toEqual([1, 2, 3]);
    expect(out.placed.map((fixture) => dateKey(fixture.scheduledAt!))).toEqual([
      "2026-08-01",
      "2026-08-08",
      "2026-08-15",
    ]);
  });

  it("keeps every placement inside the configured daily time window", () => {
    const input = baseInput([
      { round: 1, home: "A", away: "B" },
      { round: 1, home: "C", away: "D" },
      { round: 1, home: "E", away: "F" },
      { round: 1, home: "G", away: "H" },
    ]);
    input.dayStartMins = 9 * 60 + 30;
    input.dayEndMins = 12 * 60 + 30;
    input.durationMins = 45;

    const out = scheduleFixtures(input);
    for (const fixture of out.placed) {
      const date = fixture.scheduledAt!;
      const start = date.getHours() * 60 + date.getMinutes();
      expect(start).toBeGreaterThanOrEqual(input.dayStartMins);
      expect(start + input.durationMins).toBeLessThanOrEqual(input.dayEndMins);
    }
  });
});

describe("competition date, time and finals helpers", () => {
  it("snaps and advances dates according to allowed weekdays and frequency", () => {
    const monday = snapToAllowedWeekday(new Date("2026-08-01T00:00:00"), [1]);
    expect(dateKey(monday)).toBe("2026-08-03");
    expect(dateKey(nextAllowedDay(monday, [1]))).toBe("2026-08-10");
    expect(dateKey(advanceByFrequency(monday, "custom", 0))).toBe("2026-08-04");
    expect(dateKey(advanceByFrequency(monday, "biweekly", 7))).toBe("2026-08-17");
  });

  it("parses and formats time boundaries safely", () => {
    expect(parseTimeToMins("09:30", 600)).toBe(570);
    expect(parseTimeToMins("bad", 600)).toBe(600);
    expect(parseTimeToMins("99:99", 600)).toBe(1440);
    expect(minsToTime(570)).toBe("09:30");
  });

  it("advances monthly schedules without mutating the source date", () => {
    const source = new Date("2026-01-15T00:00:00");
    const advanced = advanceByFrequency(source, "monthly", 7);

    expect(dateKey(advanced)).toBe("2026-02-15");
    expect(dateKey(source)).toBe("2026-01-15");
  });

  it("builds the correct finals seed pairs for every format", () => {
    expect(buildFinalsSeedPairings("gf")).toHaveLength(1);
    expect(buildFinalsSeedPairings("top4")).toHaveLength(2);
    expect(buildFinalsSeedPairings("top6")).toHaveLength(3);
    expect(buildFinalsSeedPairings("top8")).toEqual([
      { homeSeed: 1, awaySeed: 2, isGrandFinal: true },
      { homeSeed: 3, awaySeed: 4, isGrandFinal: false },
      { homeSeed: 5, awaySeed: 6, isGrandFinal: false },
      { homeSeed: 7, awaySeed: 8, isGrandFinal: false },
    ]);
  });

  it("places finals strictly after the regular season while avoiding occupied pitches", () => {
    const occupied = new Map([["2026-08-08", [{ startMins: 540, endMins: 600, pitch: "Pitch 1" }]]]);
    const finals = placeFinalsFixtures({
      round: 4, format: "top4", afterDate: new Date("2026-08-01T00:00:00"), allowedWeekdays: [6],
      dayStartMins: 540, dayEndMins: 660, durationMins: 60, pitchLabels: ["Pitch 1", "Pitch 2"], occupiedByDate: occupied,
    });
    expect(finals).toHaveLength(2);
    expect(finals.every((f) => dateKey(f.scheduledAt!) === "2026-08-08")).toBe(true);
    expect(finals[0]).toMatchObject({ homeLabel: "1st seed", awayLabel: "2nd seed", note: "Grand Final · 1 v 2", pitch: "Pitch 2" });
    expect(finals[1].scheduledAt?.getHours()).toBe(10);
  });
});
