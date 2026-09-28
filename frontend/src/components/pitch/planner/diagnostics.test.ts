import { describe, expect, it } from "vitest";
import { analyzeFairnessDiagnostics, type FairnessDiagnosticForecast } from "./diagnostics";

const forecasts = (...minutes: number[]): FairnessDiagnosticForecast[] =>
  minutes.map((predictedMinutes, index) => ({
    player: { id: `player-${index + 1}` },
    predictedMinutes,
  }));

const analyze = (
  values: FairnessDiagnosticForecast[],
  overrides: Partial<Parameters<typeof analyzeFairnessDiagnostics>[0]> = {},
) => analyzeFairnessDiagnostics({
  forecasts: values,
  teamSize: 7,
  squadSize: 10,
  matchMinutes: 40,
  minShiftSeconds: 180,
  rotateGkAtHalftime: false,
  mode: "Standard",
  ...overrides,
});

describe("AutoSub fairness diagnostics", () => {
  it("does not show a fairness diagnostic without forecasts or a bench", () => {
    expect(analyze([])).toBeNull();
    expect(analyze(forecasts(40, 40, 40, 40, 40, 40, 40), { squadSize: 7 })).toBeNull();
  });

  it("excludes a full-game goalkeeper from outfield target and spread calculations", () => {
    const result = analyze([
      { player: { id: "keeper" }, predictedMinutes: 40, gkRole: "full" },
      ...forecasts(27, 27, 27, 26, 26, 27, 26, 27, 27),
    ]);

    expect(result).toMatchObject({
      targetMinutes: 240 / 9,
      minimumMinutes: 26,
      maximumMinutes: 27,
      spreadMinutes: 1,
      mathematicalFloorMinutes: 1,
      tone: "good",
      hasRotatingGoalkeeper: false,
    });
  });

  it("reports a tight plan as fair", () => {
    const result = analyze(forecasts(28, 28, 28, 28, 27, 27, 28, 28, 28, 28));

    expect(result?.tone).toBe("good");
    expect(result?.message).toContain("Fair plan");
    expect(result?.fairnessPercentage).toBeGreaterThan(95);
  });

  it("suggests Frequent mode for a moderately uneven Standard plan with a large bench", () => {
    const result = analyze(forecasts(30, 30, 29, 29, 28, 28, 27, 27, 26, 25), {
      teamSize: 7,
      squadSize: 12,
    });

    expect(result?.tone).toBe("info");
    expect(result?.message).toContain("Try Frequent mode");
  });

  it("identifies minimum-shift constraints instead of recommending more rotations", () => {
    const result = analyze(forecasts(9, 8, 7, 6, 5, 5), {
      teamSize: 3,
      squadSize: 6,
      matchMinutes: 20,
      minShiftSeconds: 8 * 60,
      mode: "Frequent",
    });

    expect(result?.tone).toBe("info");
    expect(result?.message).toContain("Minimum time on field");
  });

  it("warns about a highly uneven large-bench plan", () => {
    const result = analyze(forecasts(35, 34, 32, 29, 25, 24, 22, 21, 20, 18, 17, 15), {
      teamSize: 7,
      squadSize: 12,
    });

    expect(result?.tone).toBe("warn");
    expect(result?.message).toContain("Large bench");
  });

  it("flags a halftime goalkeeper rotation only when no full-game goalkeeper exists", () => {
    const rotating = analyze([
      { player: { id: "keeper-1" }, predictedMinutes: 20, gkRole: "1h" },
      { player: { id: "keeper-2" }, predictedMinutes: 20, gkRole: "2h" },
      ...forecasts(28, 28, 28, 28, 27, 27, 27, 27),
    ], { rotateGkAtHalftime: true });
    const fullGame = analyze([
      { player: { id: "keeper" }, predictedMinutes: 40, gkRole: "full" },
      ...forecasts(27, 27, 27, 27, 27, 27, 26, 26, 26),
    ], { rotateGkAtHalftime: true });

    expect(rotating?.hasRotatingGoalkeeper).toBe(true);
    expect(fullGame?.hasRotatingGoalkeeper).toBe(false);
  });

  it("reports a zero mathematical floor when player-minutes divide evenly", () => {
    expect(analyze(forecasts(20, 20, 20, 20, 20, 20, 20, 20), {
      teamSize: 4,
      squadSize: 8,
    })?.mathematicalFloorMinutes).toBe(0);
  });
});
