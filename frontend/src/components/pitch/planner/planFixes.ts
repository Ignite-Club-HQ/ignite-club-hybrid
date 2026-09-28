// ===========================================================================
// Plan fix suggestions — coach-facing diagnose → fix → preview decision logic.
// Reads the auto-computed fairness report + current overrides, infers concrete
// problems, and offers tappable fixes that mutate AutoSubAdvancedOverrides.
// ===========================================================================
import { ADV_DEFAULTS, type AutoSubAdvancedOverrides } from "./advancedOverrides";

export interface PlanFix {
  id: string;
  title: string;
  tradeoff: string;
  /** Returns the mutated overrides; clamped to the same min/max as the sliders. */
  apply: (current: AutoSubAdvancedOverrides) => AutoSubAdvancedOverrides;
}

export const SLIDER_RANGES = {
  standardTargetIntervalSec: { min: 180, max: 900 },
  standardIntervalFloorSec: { min: 120, max: 600 },
  frequentIntervalFloorSec: { min: 60, max: 420 },
  minShiftSeconds: { min: 60, max: 360 },
  halftimeGuardSeconds: { min: 0, max: 420 },
} as const;

export function clampOverride(
  key: keyof typeof SLIDER_RANGES,
  next: number,
): number {
  const r = SLIDER_RANGES[key];
  return Math.max(r.min, Math.min(r.max, next));
}

export function bumpOverride(
  current: AutoSubAdvancedOverrides,
  key: keyof typeof SLIDER_RANGES,
  delta: number,
): AutoSubAdvancedOverrides {
  const base = current[key] ?? ADV_DEFAULTS[key as keyof typeof ADV_DEFAULTS];
  const next = clampOverride(key, base + delta);
  if (next === base) return current;
  return { ...current, [key]: next };
}

export function buildPlanFixes(args: {
  spreadMin: number;
  shortShifts: number;
  bounceBacks: number;
  totalSubs: number;
  isLargeBench: boolean;
  constrainedByMinShift: boolean;
  mode: "Standard" | "Frequent";
  overrides: AutoSubAdvancedOverrides;
  hasHalftimeClash: boolean;
}): PlanFix[] {
  const fixes: PlanFix[] = [];
  const o = args.overrides;

  // Make minutes fairer — only when the spread is meaningfully off.
  if (args.spreadMin > 3) {
    const targetKey = "standardTargetIntervalSec" as const;
    const cur = o[targetKey] ?? ADV_DEFAULTS[targetKey];
    if (cur > SLIDER_RANGES[targetKey].min) {
      fixes.push({
        id: "fairer",
        title: "Make minutes fairer",
        tradeoff: "Gives the planner more chances to balance game time, but creates more substitution moments.",
        apply: (c) => bumpOverride(c, targetKey, -60),
      });
    }
  }

  // Allow shorter shifts — when min-shift is the bottleneck.
  if (args.spreadMin > 3 && args.constrainedByMinShift) {
    const cur = o.minShiftSeconds ?? ADV_DEFAULTS.minShiftSeconds;
    if (cur > SLIDER_RANGES.minShiftSeconds.min) {
      fixes.push({
        id: "shorter-shifts",
        title: "Allow shorter shifts",
        tradeoff: "Lets the planner pull players sooner so minutes balance faster, but shifts can feel brief.",
        apply: (c) => bumpOverride(c, "minShiftSeconds", -30),
      });
    }
  }

  // Reduce short shifts — when short cameos detected.
  if (args.shortShifts > 0) {
    const cur = o.minShiftSeconds ?? ADV_DEFAULTS.minShiftSeconds;
    if (cur < SLIDER_RANGES.minShiftSeconds.max) {
      fixes.push({
        id: "protect-shifts",
        title: "Reduce short shifts",
        tradeoff: "Keeps players on for longer turns. The minutes difference between players may grow a little.",
        apply: (c) => bumpOverride(c, "minShiftSeconds", 30),
      });
    }
  }

  // Space out substitution moments — when bounce-backs detected or plan is busy.
  const busy = args.totalSubs > Math.max(6, args.spreadMin * 2);
  if (args.bounceBacks > 0 || busy) {
    const cur = o.standardIntervalFloorSec ?? ADV_DEFAULTS.standardIntervalFloorSec;
    if (cur < SLIDER_RANGES.standardIntervalFloorSec.max) {
      fixes.push({
        id: "space-out",
        title: "Space out substitution moments",
        tradeoff: "Fewer interruptions in the game, but minutes may even out more slowly.",
        apply: (c) => bumpOverride(c, "standardIntervalFloorSec", 30),
      });
    }
  }

  // Avoid subs near halftime — only when a halftime clash is detected.
  if (args.hasHalftimeClash) {
    const cur = o.halftimeGuardSeconds ?? ADV_DEFAULTS.halftimeGuardSeconds;
    if (cur < SLIDER_RANGES.halftimeGuardSeconds.max) {
      fixes.push({
        id: "halftime",
        title: "Avoid subs near halftime",
        tradeoff: "Keeps the halftime break clean, but can push some rotations earlier or later than ideal.",
        apply: (c) => bumpOverride(c, "halftimeGuardSeconds", 60),
      });
    }
  }

  // Reduce stoppages — only when plan looks overly busy and minutes are fine.
  if (args.spreadMin <= 4 && busy) {
    const cur = o.standardTargetIntervalSec ?? ADV_DEFAULTS.standardTargetIntervalSec;
    if (cur < SLIDER_RANGES.standardTargetIntervalSec.max) {
      fixes.push({
        id: "reduce-stoppages",
        title: "Reduce stoppages",
        tradeoff: "Fewer interruptions, but minutes may not balance quite as tightly.",
        apply: (c) => bumpOverride(c, "standardTargetIntervalSec", 60),
      });
    }
  }

  // Fallback — when overrides differ from recommended defaults, always offer
  // a reset so coaches who tuned themselves into a corner have one tap out.
  const overridesDirty = (Object.keys(ADV_DEFAULTS) as Array<keyof typeof ADV_DEFAULTS>)
    .some((k) => o[k] !== undefined && o[k] !== ADV_DEFAULTS[k]);
  if (overridesDirty) {
    fixes.push({
      id: "reset-defaults",
      title: "Reset to recommended defaults",
      tradeoff: "Undoes your custom slider tweaks and starts fresh from the planner's defaults.",
      apply: () => ({}),
    });
  }

  return fixes;
}

// Pick the single highest-priority fix to recommend, based on the dominant
// problem in the current plan. Falls back to the first available fix.
export function pickRecommendedFix(
  fixes: PlanFix[],
  signals: { hasHalftimeClash: boolean; shortShifts: number; bounceBacks: number; spreadMin: number; constrainedByMinShift: boolean },
): PlanFix | null {
  if (fixes.length === 0) return null;
  const byId = (id: string) => fixes.find((f) => f.id === id);
  if (signals.hasHalftimeClash) { const f = byId("halftime"); if (f) return f; }
  if (signals.shortShifts > 0) {
    const f = byId("protect-shifts"); if (f) return f;
    const r = byId("reset-defaults"); if (r) return r;
  }
  if (signals.bounceBacks > 0) { const f = byId("space-out"); if (f) return f; }
  if (signals.spreadMin > 6) {
    const f = byId("fairer"); if (f) return f;
    const r = byId("reset-defaults"); if (r) return r;
  }
  if (signals.spreadMin > 3 && signals.constrainedByMinShift) { const f = byId("shorter-shifts"); if (f) return f; }
  const reduce = byId("reduce-stoppages"); if (reduce) return reduce;
  const reset = byId("reset-defaults"); if (reset) return reset;
  return fixes[0];
}
