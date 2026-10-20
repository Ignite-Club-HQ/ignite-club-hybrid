import { describe, expect, it } from "vitest";
import { optionalScore, resultOutcome } from "./resultVisibility";

describe("protected history results", () => {
  it("does not invent a draw from withheld scores", () => {
    expect(resultOutcome(null, null)).toBeNull();
    expect(resultOutcome(23, null)).toBeNull();
  });
  it("preserves genuine zero-score draws and visible results", () => {
    expect(resultOutcome(0, 0)).toBe("DRAW");
    expect(resultOutcome(23, 17)).toBe("WIN");
    expect(resultOutcome(17, 23)).toBe("LOSS");
  });
  it("normalizes withheld Candid scores without zero coercion", () => {
    expect(optionalScore([])).toBeNull();
    expect(optionalScore(null)).toBeNull();
    expect(optionalScore([0])).toBe(0);
    expect(optionalScore([23])).toBe(23);
  });
});