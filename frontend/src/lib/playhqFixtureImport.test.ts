import { describe, expect, it } from "vitest";
import {
  extractPlayHQDates,
  extractPlayHQTimes,
  isPlayHQFormat,
  normalisePlayHQDate,
  normalisePlayHQTime,
  playHQToDriblShape,
  splitPlayHQTeam,
} from "./playhqFixtureImport";

describe("PlayHQ fixture import", () => {
  it("recognizes advanced fixture exports and splits team grade/group", () => {
    expect(isPlayHQFormat(["Game Date", "Home Team", "Away Team", "Grade"])).toBe(true);
    expect(splitPlayHQTeam("Stirling U12 White")).toEqual({ club: "Stirling", grade: "U12", group: "White" });
  });

  it("normalizes Excel, ISO, Australian, and shared-range dates", () => {
    expect(normalisePlayHQDate("2026-10-17")).toBe("17/10/2026");
    expect(normalisePlayHQDate("17 Oct 2026")).toBe("17/10/2026");
    expect(extractPlayHQDates("17-18/10/2026")).toEqual(["17/10/2026", "18/10/2026"]);
    expect(extractPlayHQDates("17/10/2026, 18/10/2026")).toEqual(["17/10/2026", "18/10/2026"]);
  });

  it("normalizes 12-hour and multiple start times", () => {
    expect(normalisePlayHQTime("9:30am")).toBe("09:30");
    expect(normalisePlayHQTime("2:15pm")).toBe("14:15");
    expect(extractPlayHQTimes("09:00, 10:30")).toEqual(["09:00", "10:30"]);
  });

  it("expands multi-day games, preserves finals labels, and reports skipped rows", () => {
    const converted = playHQToDriblShape(
      ["Game ID", "Competition", "Round", "Game Date", "Game Time", "Playing Surface", "Grade", "Home Team", "Away Team", "Game Status"],
      [
        ["m-1", "Summer", "Grand Final", "17-18/10/2026", "09:00, 10:30", "Oval 1", "U12", "Stirling U12 White", "TBD", "Scheduled"],
        ["m-2", "Summer", "3", "2026-10-19", "11:00", "Oval 2", "U10", "Stirling U10 Blue", "Visitors U10 Red", "Cancelled"],
      ],
    );
    expect(converted.rows).toHaveLength(2);
    expect(converted.rows[0]).toContain("Grand Final (Day 1 of 2)");
    expect(converted.rows[1]).toContain("Grand Final (Day 2 of 2)");
    expect(converted.rows[1][12]).toBe("TBD");
    expect(converted.skipped).toEqual([{ row: 3, message: "Bye, cancelled, or forfeited game skipped." }]);
  });
});