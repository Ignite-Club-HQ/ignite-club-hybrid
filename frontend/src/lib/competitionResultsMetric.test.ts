import { describe, expect, it } from "vitest";
import { countCompletedMatches } from "./competitionResultsMetric";

describe("countCompletedMatches", () => {
  it("counts only completed matches", () => {
    expect(countCompletedMatches([
      { status: "completed" },
      { status: "scheduled" },
      { status: "cancelled" },
    ])).toBe(1);
  });
  it("ignores scored matches that are not completed", () => {
    expect(countCompletedMatches([{ status: "in_progress", home_score: 3, away_score: 1 } as any])).toBe(0);
  });
  it("counts completed matches with unusual or missing scores", () => {
    expect(countCompletedMatches([{ status: "completed", home_score: null, away_score: 0 } as any])).toBe(1);
  });
});
