import { describe, expect, it } from "vitest";
import { formatResultSentence, formatScoreLine, outcomeFor } from "./matchResultFormat";
import { getSportScoreConfig } from "./sportScoreConfig";

const input = (sport: string, homeScore: number, awayScore: number, periodScores?: unknown) => ({
  config: getSportScoreConfig(sport), homeLabel: "Riverside", awayLabel: "United", homeScore, awayScore, periodScores,
});

describe("sport-aware match result formatting", () => {
  it("formats ordinary home wins, away wins and draws", () => {
    expect(formatResultSentence(input("soccer", 3, 1))).toBe("Riverside won 3–1");
    expect(formatResultSentence(input("soccer", 1, 4))).toBe("United won 4–1");
    expect(formatResultSentence(input("soccer", 2, 2))).toBe("Draw 2–2");
  });

  it("formats cricket margins with singular and plural runs", () => {
    expect(formatResultSentence(input("cricket", 101, 100))).toBe("Riverside won by 1 run");
    expect(formatResultSentence(input("cricket", 98, 120))).toBe("United won by 22 runs");
  });

  it("formats cricket innings details including all out and overs", () => {
    expect(formatScoreLine(input("cricket", 120, 98, {
      home: { wickets: 6, overs: "20.0" }, away: { wickets: 10, overs: "18.4" },
    }))).toBe("Riverside 120/6 (20.0 ov) vs 98 all out (18.4 ov) United");
  });

  it("formats AFL goal/behind detail and point margins", () => {
    const score = input("afl", 58, 49, { home: { goals: 8, behinds: 10 }, away: { goals: 7, behinds: 7 } });
    expect(formatScoreLine(score)).toBe("Riverside 8.10 (58) – 7.7 (49) United");
    expect(formatResultSentence(score)).toBe("Riverside won by 9 points");
  });

  it("derives safe AFL goal and behind values when period detail is absent", () => {
    expect(formatScoreLine(input("afl", 13, 6))).toBe("Riverside 2.1 (13) – 1.0 (6) United");
  });

  it("formats set-based wins and draws", () => {
    expect(formatScoreLine(input("volleyball", 3, 1))).toBe("Riverside 3 – 1 United in sets");
    expect(formatResultSentence(input("volleyball", 3, 1))).toBe("Riverside won 3–1 in sets");
    expect(formatResultSentence(input("volleyball", 2, 2))).toBe("Draw 2–2 in sets");
  });

  it.each([
    [3, 1, "win"], [1, 3, "loss"], [0, 0, "draw"],
  ] as const)("classifies %s–%s from the home perspective as %s", (home, away, expected) => {
    expect(outcomeFor(home, away)).toBe(expected);
  });
});
