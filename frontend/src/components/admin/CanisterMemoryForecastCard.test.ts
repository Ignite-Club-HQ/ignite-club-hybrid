import { describe, expect, it } from "vitest";
import { forecastMemory } from "./canisterMemoryForecast";

const now = Date.parse("2026-10-16T00:00:00Z");
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

describe("forecastMemory", () => {
  it("flags Act now at 3 GB even without history", () => {
    expect(forecastMemory([{ key: "a", memoryMb: 3100 }], [], now)[0].level).toBe("act");
  });
  it("flags Watch at 2.5 GB", () => {
    expect(forecastMemory([{ key: "a", memoryMb: 2600 }], [], now)[0].level).toBe("watch");
  });
  it("flags Act now when projected to hit 4 GB within 30 days", () => {
    // 1000 MB -> 2000 MB in 10 days = 100 MB/day, 2096 MB left ≈ 21 days
    const f = forecastMemory(
      [{ key: "a", memoryMb: 2000 }],
      [{ at: daysAgo(10), source: "manual", readings: [{ name: "a", memory_mb: 1000 }], analysis: null }],
      now,
    )[0];
    expect(Math.round(f.daysToCeiling!)).toBe(21);
    expect(f.level).toBe("act");
  });
  it("stays OK for small, slow canisters", () => {
    const f = forecastMemory(
      [{ key: "a", memoryMb: 200 }],
      [{ at: daysAgo(10), source: "manual", readings: [{ name: "a", memory_mb: 190 }], analysis: null }],
      now,
    )[0];
    expect(f.level).toBe("ok");
  });
});

import { detectSpikes, memorySeries } from "./canisterMemoryForecast";

describe("detectSpikes", () => {
  const rep = (d: number, mb: number) => ({ at: daysAgo(d), source: "auto", readings: [{ name: "a", memory_mb: mb }], analysis: null });
  it("flags a jump of 100 MB and 15%", () => {
    expect(detectSpikes(memorySeries([rep(2, 500), rep(1, 650)], [], now))).toHaveLength(1);
  });
  it("ignores a 100 MB jump that is under 15%", () => {
    expect(detectSpikes(memorySeries([rep(2, 2000), rep(1, 2150)], [], now))).toHaveLength(0);
  });
  it("ignores a 15% jump under 100 MB", () => {
    expect(detectSpikes(memorySeries([rep(2, 100), rep(1, 180)], [], now))).toHaveLength(0);
  });
});
