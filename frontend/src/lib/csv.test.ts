import { describe, expect, it } from "vitest";
import { isValidEmail, parseCsvLine } from "./csv";

describe("CSV helpers", () => {
  it("preserves quoted commas and trims unquoted values", () => {
    expect(parseCsvLine('  Smith, Jr. ,"parent@example.invalid" ')).toEqual([
      "Smith",
      "Jr.",
      "parent@example.invalid",
    ]);
  });

  it("validates the email shape used by member imports", () => {
    expect(isValidEmail("member@example.invalid")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
  });
});
