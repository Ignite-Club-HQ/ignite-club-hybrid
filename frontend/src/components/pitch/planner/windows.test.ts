import { describe, expect, it } from "vitest";
import { buildSubWindows, isInBlackout } from "./windows";

const HALF = 25 * 60; // 1500
const END = HALF * 2; // 3000

const baseInput = {
  startAbs: 0,
  endAbs: END,
  halfDurationSeconds: HALF,
  targetIntervalSec: 7 * 60, // 420
  intervalFloorSec: 4 * 60, // 240
  noSubBeforeSec: 5 * 60, // 300
  noSubAfterSec: 150,
  halftimeGuardSec: 90,
  halftimeGuardActive: false,
};

describe("buildSubWindows", () => {
  it("respects settling-in and end-of-half blackouts", () => {
    const windows = buildSubWindows(baseInput);
    for (const t of windows) {
      // Not in first 5 min
      expect(t).toBeGreaterThanOrEqual(baseInput.noSubBeforeSec);
      // Not in last 2.5 min of either half
      const inH1End = t > HALF - baseInput.noSubAfterSec && t <= HALF;
      const inH2End = t > END - baseInput.noSubAfterSec;
      expect(inH1End).toBe(false);
      expect(inH2End).toBe(false);
      // Not in post-HT settling
      expect(t > HALF && t < HALF + baseInput.noSubBeforeSec).toBe(false);
    }
  });

  it("clamps interval to the floor when target is below it", () => {
    const windows = buildSubWindows({
      ...baseInput,
      targetIntervalSec: 60, // below floor 240
    });
    // Consecutive deltas (within same half) should be ≥ floor
    for (let i = 1; i < windows.length; i++) {
      const prev = windows[i - 1];
      const cur = windows[i];
      // Skip the HT-crossing pair, where the post-HT settling reset can leave
      // a larger natural gap that's still >= floor anyway.
      expect(cur - prev).toBeGreaterThanOrEqual(baseInput.intervalFloorSec - 1);
    }
  });

  it("applies halftime guard only when active", () => {
    const off = buildSubWindows({ ...baseInput, halftimeGuardActive: false, halftimeGuardSec: 600 });
    const on = buildSubWindows({ ...baseInput, halftimeGuardActive: true, halftimeGuardSec: 600 });
    // With a huge guard active, no interval window can sit within ±600s of HT.
    for (const t of on) {
      expect(Math.abs(t - HALF)).toBeGreaterThanOrEqual(600);
    }
    // Without guard, some windows may legitimately sit nearer HT (subject to
    // edge buffer + end-of-half blackout).
    expect(off.length).toBeGreaterThanOrEqual(on.length);
  });

  it("forcedTimes always survive blackouts", () => {
    const forced = [120, HALF - 30, HALF + 60]; // all in some blackout
    const windows = buildSubWindows({
      ...baseInput,
      halftimeGuardActive: true,
      halftimeGuardSec: 300,
      forcedTimes: forced,
    });
    for (const ft of forced) {
      expect(windows).toContain(ft);
    }
  });

  it("forcedBufferSec suppresses nearby interval candidates", () => {
    const forced = [10 * 60]; // 600
    const buffered = buildSubWindows({
      ...baseInput,
      forcedTimes: forced,
      forcedBufferSec: 180,
    });
    const noBuffer = buildSubWindows({ ...baseInput, forcedTimes: forced, forcedBufferSec: 0 });
    // Interval-driven windows within 180 s of 600 should be removed (forced
    // time itself is preserved).
    const nearBuffered = buffered.filter(t => t !== 600 && Math.abs(t - 600) <= 180);
    expect(nearBuffered.length).toBe(0);
    expect(buffered).toContain(600);
    expect(noBuffer.length).toBeGreaterThanOrEqual(buffered.length);
  });

  it("dedupes overlapping forced + extra + interval times", () => {
    const ft = 12 * 60;
    const windows = buildSubWindows({
      ...baseInput,
      forcedTimes: [ft, ft],
      extraTimes: [ft],
    });
    const occurrences = windows.filter(t => t === ft).length;
    expect(occurrences).toBe(1);
  });

  it("returns sorted, integer times", () => {
    const windows = buildSubWindows({
      ...baseInput,
      forcedTimes: [HALF - 100, 600.7],
      extraTimes: [HALF + 800],
    });
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]).toBeGreaterThan(windows[i - 1]);
    }
    for (const t of windows) expect(Number.isInteger(t)).toBe(true);
  });

  it("includes halftime when guard active and caller opts in", () => {
    const w = buildSubWindows({
      ...baseInput,
      halftimeGuardActive: true,
      includeHalftimeWhenGuardActive: true,
    });
    expect(w).toContain(HALF);
  });
});

describe("isInBlackout", () => {
  it("flags settling-in, end-of-half, and HT guard", () => {
    const opts = {
      halfDurationSeconds: HALF,
      endAbs: END,
      noSubBeforeSec: 300,
      noSubAfterSec: 150,
      halftimeGuardSec: 120,
      halftimeGuardActive: true,
    };
    expect(isInBlackout(60, opts)).toBe(true); // settling-in
    expect(isInBlackout(HALF - 30, opts)).toBe(true); // end of H1
    expect(isInBlackout(HALF + 30, opts)).toBe(true); // post-HT settling AND guard
    expect(isInBlackout(END - 30, opts)).toBe(true); // end of H2
    expect(isInBlackout(10 * 60, opts)).toBe(false); // mid H1
  });
});
