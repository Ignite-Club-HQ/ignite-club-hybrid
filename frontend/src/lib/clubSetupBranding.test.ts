import { describe, expect, it } from "vitest";
import { hasSavedClubBranding } from "./clubSetupBranding";

describe("saved club branding", () => {
  it("recognises a saved light theme without Pro activation", () => {
    expect(hasSavedClubBranding({ theme_primary_h: 0, theme_enabled: false })).toBe(true);
  });
  it("recognises a saved ICP theme without Pro activation", () => {
    expect(hasSavedClubBranding({ theme_primary_color: ["160 84% 45%"], theme_enabled: false })).toBe(true);
  });
  it("does not treat an enabled toggle or empty palette as saved branding", () => {
    expect(hasSavedClubBranding({ theme_enabled: true, theme_primary_color: [], theme_primary_h: null })).toBe(false);
  });
});