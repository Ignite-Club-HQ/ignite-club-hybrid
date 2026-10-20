import { describe, expect, it } from "vitest";
import { computeLiveLadder } from "./PublicCompetitionPage";

const match = (over: Partial<Parameters<typeof computeLiveLadder>[0][number]>) => ({
  id: crypto.randomUUID(),
  status: "completed",
  home_team: "Home",
  away_team: "Away",
  home_score: 0,
  away_score: 0,
  ...over,
});

describe("computeLiveLadder (ICP public competition page)", () => {
  it("awards the competition's configured win/draw/loss points", () => {
    const rows = computeLiveLadder(
      [match({ home_score: 2, away_score: 1 })],
      3, 1, 0,
    );
    const home = rows.find((r) => r.team === "Home")!;
    const away = rows.find((r) => r.team === "Away")!;
    expect(home).toMatchObject({ played: 1, wins: 1, points: 3, goalDiff: 1 });
    expect(away).toMatchObject({ played: 1, losses: 1, points: 0, goalDiff: -1 });
  });

  it("excludes masked scores without changing configured points for visible results", () => {
    const rows = computeLiveLadder([
      match({ home_score: null, away_score: null }),
      match({ home_team: "Visible", away_team: "Opponent", home_score: 2, away_score: 1 }),
    ], 7, 4, 2);
    expect(rows.map(r => r.team)).not.toContain("Home");
    expect(rows.find(r => r.team === "Visible")).toMatchObject({ played: 1, points: 7 });
    expect(rows.find(r => r.team === "Opponent")).toMatchObject({ played: 1, points: 2 });
  });

  it("splits points on a draw", () => {
    const rows = computeLiveLadder([match({ home_score: 1, away_score: 1 })], 3, 1, 0);
    expect(rows.every((r) => r.draws === 1 && r.points === 1)).toBe(true);
  });

  it("ignores scheduled matches that have not been played", () => {
    const rows = computeLiveLadder([match({ status: "scheduled" })], 3, 1, 0);
    expect(rows).toHaveLength(0);
  });

  it("sorts by points then goal difference", () => {
    const rows = computeLiveLadder(
      [
        match({ home_team: "A", away_team: "B", home_score: 1, away_score: 0 }),
        match({ home_team: "C", away_team: "D", home_score: 4, away_score: 0 }),
      ],
      3, 1, 0,
    );
    expect(rows[0].team).toBe("C");
    expect(rows[1].team).toBe("A");
  });
});
