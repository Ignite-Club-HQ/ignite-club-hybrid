import { describe, expect, it } from "vitest";
import {
  createTierWeightedPlaylist,
  sponsorTierDuration,
} from "./sponsorTier";

describe("sponsor tier presentation", () => {
  it("keeps the existing tier weights and display durations", () => {
    expect(createTierWeightedPlaylist([
      { tier: "platinum" },
      { tier: "gold" },
      { tier: "bronze" },
      { tier: null },
    ])).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 3, 3]);
    expect(sponsorTierDuration("platinum")).toBe(20_000);
    expect(sponsorTierDuration("gold")).toBe(18_000);
    expect(sponsorTierDuration("silver")).toBe(12_000);
    expect(sponsorTierDuration("bronze")).toBe(8_000);
    expect(sponsorTierDuration(null)).toBe(12_000);
  });
});
