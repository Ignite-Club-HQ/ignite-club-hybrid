import { describe, expect, it } from "vitest";
import { ADV_DEFAULTS, type AutoSubAdvancedOverrides } from "./advancedOverrides";
import { SLIDER_RANGES, bumpOverride, buildPlanFixes, pickRecommendedFix } from "./planFixes";

const baseArgs = {
  spreadMin: 0,
  shortShifts: 0,
  bounceBacks: 0,
  totalSubs: 0,
  isLargeBench: false,
  constrainedByMinShift: false,
  mode: "Standard" as const,
  overrides: {} as AutoSubAdvancedOverrides,
  hasHalftimeClash: false,
};

describe("bumpOverride", () => {
  it("clamps adjustments to the slider's max range", () => {
    const current: AutoSubAdvancedOverrides = { minShiftSeconds: SLIDER_RANGES.minShiftSeconds.max - 10 };
    const bumped = bumpOverride(current, "minShiftSeconds", 30);
    expect(bumped.minShiftSeconds).toBe(SLIDER_RANGES.minShiftSeconds.max);
  });

  it("clamps adjustments to the slider's min range", () => {
    const current: AutoSubAdvancedOverrides = { minShiftSeconds: SLIDER_RANGES.minShiftSeconds.min + 10 };
    const bumped = bumpOverride(current, "minShiftSeconds", -30);
    expect(bumped.minShiftSeconds).toBe(SLIDER_RANGES.minShiftSeconds.min);
  });

  it("returns the same reference when the value would not change", () => {
    const current: AutoSubAdvancedOverrides = { minShiftSeconds: SLIDER_RANGES.minShiftSeconds.min };
    const bumped = bumpOverride(current, "minShiftSeconds", -30);
    expect(bumped).toBe(current);
  });

  it("falls back to ADV_DEFAULTS when the override is unset", () => {
    const bumped = bumpOverride({}, "minShiftSeconds", 30);
    expect(bumped.minShiftSeconds).toBe(ADV_DEFAULTS.minShiftSeconds + 30);
  });
});

describe("pickRecommendedFix priority selection", () => {
  it("prioritises the halftime fix when a halftime clash is detected, even amid other problems", () => {
    const fixes = buildPlanFixes({
      ...baseArgs,
      spreadMin: 8,
      shortShifts: 2,
      bounceBacks: 1,
      hasHalftimeClash: true,
    });
    const recommended = pickRecommendedFix(fixes, {
      hasHalftimeClash: true,
      shortShifts: 2,
      bounceBacks: 1,
      spreadMin: 8,
      constrainedByMinShift: false,
    });
    expect(recommended?.id).toBe("halftime");
  });

  it("prioritises protecting short shifts over spread when no halftime clash exists", () => {
    const fixes = buildPlanFixes({
      ...baseArgs,
      spreadMin: 8,
      shortShifts: 1,
      overrides: { minShiftSeconds: 200 },
    });
    const recommended = pickRecommendedFix(fixes, {
      hasHalftimeClash: false,
      shortShifts: 1,
      bounceBacks: 0,
      spreadMin: 8,
      constrainedByMinShift: false,
    });
    expect(recommended?.id).toBe("protect-shifts");
  });

  it("falls back to making minutes fairer when the spread is large and nothing else applies", () => {
    const fixes = buildPlanFixes({ ...baseArgs, spreadMin: 8 });
    const recommended = pickRecommendedFix(fixes, {
      hasHalftimeClash: false,
      shortShifts: 0,
      bounceBacks: 0,
      spreadMin: 8,
      constrainedByMinShift: false,
    });
    expect(recommended?.id).toBe("fairer");
  });

  it("returns null when there are no fixes to recommend", () => {
    const recommended = pickRecommendedFix([], {
      hasHalftimeClash: false,
      shortShifts: 0,
      bounceBacks: 0,
      spreadMin: 0,
      constrainedByMinShift: false,
    });
    expect(recommended).toBeNull();
  });
});

describe("buildPlanFixes", () => {
  it("always offers a reset when overrides differ from recommended defaults", () => {
    const fixes = buildPlanFixes({ ...baseArgs, overrides: { minShiftSeconds: 300 } });
    expect(fixes.some((f) => f.id === "reset-defaults")).toBe(true);
  });

  it("offers no fixes for a clean plan with default overrides", () => {
    const fixes = buildPlanFixes(baseArgs);
    expect(fixes).toEqual([]);
  });
});
