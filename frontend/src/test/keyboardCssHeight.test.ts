import { describe, expect, it } from "vitest";
import { resolveKeyboardCssHeight } from "@/lib/keyboardCssHeight";

describe("resolveKeyboardCssHeight", () => {
  it("passes through iOS point values unchanged", () => {
    expect(resolveKeyboardCssHeight(300, 800, 2)).toBe(300);
  });

  it("converts Android device-px reports to CSS px", () => {
    // dpr 2.625 device: 300 CSS px keyboard reported as 787 device px.
    expect(resolveKeyboardCssHeight(787, 770, 2.625)).toBe(300);
  });

  it("keeps legitimate CSS-px values below the 60% threshold", () => {
    expect(resolveKeyboardCssHeight(450, 800, 3)).toBe(450);
  });

  it("clamps runaway values to 60% of the window", () => {
    expect(resolveKeyboardCssHeight(700, 800, 1)).toBe(480);
  });

  it("returns 0 for missing or invalid input", () => {
    expect(resolveKeyboardCssHeight(0, 800, 2)).toBe(0);
    expect(resolveKeyboardCssHeight(Number.NaN, 800, 2)).toBe(0);
  });
});
