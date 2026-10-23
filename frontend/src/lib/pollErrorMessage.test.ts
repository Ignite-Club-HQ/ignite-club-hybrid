import { describe, it, expect } from "vitest";
import { pollErrorMessage } from "./pollErrorMessage";
describe("pollErrorMessage", () => {
  it("explains permission failures", () => {
    expect(pollErrorMessage({ code: "42501", message: 'new row violates row-level security policy for table "polls"' }, "x"))
      .toBe("You don't have permission to do this in this chat.");
  });
  it("falls back when there is no message", () => {
    expect(pollErrorMessage({}, "Failed to create poll")).toBe("Failed to create poll");
  });
});
