import { describe, expect, it } from "vitest";
import { googleSignInEnabled } from "./authProviderFlags";
describe("explicit production Google sign-in activation", () => {
  it("stays disabled without a verified deployment opt-in", () => {
    for (const setting of [undefined, null, "false", "1", "TRUE", true]) expect(googleSignInEnabled(setting)).toBe(false);
  });
  it("can restore the production provider through the public deployment setting", () => {
    expect(googleSignInEnabled("true")).toBe(true);
  });
});