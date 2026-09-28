import { describe, expect, it } from "vitest";
import { resolveClubProAccess } from "./useClubProAccess";

describe("resolveClubProAccess", () => {
  const now = new Date("2026-07-19T12:00:00Z");

  it("denies a club without a subscription", () => {
    expect(resolveClubProAccess(null, now)).toEqual({
      hasPro: false,
      hasProFootball: false,
      resolved: true,
    });
  });

  it.each([
    [{ is_pro: true }, { hasPro: true, hasProFootball: false }],
    [{ admin_pro_override: true }, { hasPro: true, hasProFootball: false }],
    [{ is_pro_football: true }, { hasPro: true, hasProFootball: true }],
    [{ admin_pro_football_override: true }, { hasPro: true, hasProFootball: true }],
  ])("grants active paid and admin entitlements", (subscription, expected) => {
    expect(resolveClubProAccess(subscription, now)).toMatchObject(expected);
  });

  it("treats football Pro as access to general Pro features", () => {
    expect(resolveClubProAccess({ is_pro_football: true }, now)).toMatchObject({
      hasPro: true,
      hasProFootball: true,
    });
  });

  it.each(["2026-07-19T11:59:59Z", "2026-07-19T12:00:00Z"])(
    "denies an expired entitlement at %s",
    (expires_at) => {
      expect(resolveClubProAccess({ is_pro: true, expires_at }, now)).toMatchObject({
        hasPro: false,
        hasProFootball: false,
      });
    },
  );

  it("grants an entitlement that expires in the future", () => {
    expect(
      resolveClubProAccess({ is_pro: true, expires_at: "2026-07-19T12:00:01Z" }, now),
    ).toMatchObject({ hasPro: true });
  });
});
