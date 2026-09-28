/**
 * Guard: a notification-driven club switch must survive `useClubTheme`'s async
 * bootstrap, and the native cold-start tap must stash the switch itself rather
 * than relying on a CustomEvent that fires before React mounts.
 *
 * Both were real production defects: the app opened a Bridgewater group thread
 * while the global filter stayed on Basket Range.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  markNotificationClubSwitchApplied,
  getAppliedNotificationClubSwitch,
  clearAppliedNotificationClubSwitch,
} from "@/lib/notificationClubSwitch";

beforeEach(() => {
  clearAppliedNotificationClubSwitch();
});

describe("applied notification club switch pin", () => {
  it("round-trips the pinned club id", () => {
    expect(getAppliedNotificationClubSwitch()).toBeNull();
    markNotificationClubSwitchApplied("club-B");
    expect(getAppliedNotificationClubSwitch()).toBe("club-B");
  });

  it("expires so a stale pin cannot hijack a later session", () => {
    sessionStorage.setItem(
      "ignite_notification_club_switch_applied",
      JSON.stringify({ clubId: "club-B", ts: Date.now() - 600_000 }),
    );
    expect(getAppliedNotificationClubSwitch()).toBeNull();
  });

  it("is cleared explicitly (club picker path)", () => {
    markNotificationClubSwitchApplied("club-B");
    clearAppliedNotificationClubSwitch();
    expect(getAppliedNotificationClubSwitch()).toBeNull();
  });

  it("uses an ignite_ prefixed key so clearUserScopedCaches sweeps it", () => {
    markNotificationClubSwitchApplied("club-B");
    const keys = Object.keys(sessionStorage);
    expect(keys.some((k) => k.startsWith("ignite_") && k.includes("club_switch_applied"))).toBe(true);
  });
});

describe("provider must not clobber a pinned switch", () => {
  const src = readFileSync("src/hooks/useClubTheme.tsx", "utf8");

  it("routes bootstrap writes through a guard that honours the pin", () => {
    expect(src).toContain("getAppliedNotificationClubSwitch");
    // The guarded setter must exist and gate on the pin.
    expect(src).toMatch(/const setActiveClubThemeState = \([\s\S]{0,400}getAppliedNotificationClubSwitch\(\)/);
  });

  it("keeps explicit user selection authoritative", () => {
    expect(src).toContain("clearAppliedNotificationClubSwitch");
    expect(src).toMatch(/const setActiveClubTheme = \([\s\S]{0,600}setActiveClubThemeStateRaw\(clubId\)/);
  });

  it("keeps rendered theme data identity aligned with the active club", () => {
    expect(src).toContain("cachedThemeData?.clubId === activeClubTheme");
    expect(src).toContain("notificationPinnedClub");
    expect(src).toMatch(/notificationPinnedClub[\s\S]{0,300}active_club_theme_id: notificationPinnedClub/);
  });

  it("does not discard team-only clubs before team roles are loaded", () => {
    expect(src).not.toContain("if (!userRoles?.length) return []");
  });
});

describe("web push payload compatibility", () => {
  const src = readFileSync("src/lib/webNotificationLaunchHandler.ts", "utf8");

  it("accepts nested and legacy url field variants like the native handler", () => {
    expect(src).toContain("payload.url || payload.link || payload.path");
    expect(src).toContain("data?.url || data?.link || data?.path");
  });
});

describe("native cold-start tap stashes the switch directly", () => {
  const src = readFileSync("src/lib/notificationLaunchHandler.ts", "utf8");

  it("calls requestClubSwitchForNotification without waiting for a listener", () => {
    expect(src).toContain("requestClubSwitchForNotification");
    // Must be invoked in the handler, not merely imported.
    expect(src).toMatch(/requestClubSwitchForNotification\(data, path\)/);
  });
});

describe("unresolved tap-time requests are re-resolved after auth is ready", () => {
  const lib = readFileSync("src/lib/notificationClubSwitch.ts", "utf8");
  const hook = readFileSync("src/hooks/useNotificationClubSwitch.ts", "utf8");

  it("stashes the raw request synchronously at tap time", () => {
    // The tap-time teams lookup can race the Supabase session restore on cold
    // start; the raw request must be stashed BEFORE any async resolution.
    expect(lib).toMatch(/export function requestClubSwitchForNotification[\s\S]{0,400}stashRequest\(data, url\)/);
  });

  it("the hook drains raw requests via deferred resolution with bounded retries", () => {
    expect(hook).toContain("peekPendingNotificationClubSwitchRequest");
    expect(hook).toContain("resolveNotificationClubId");
    expect(hook).toContain("MAX_RESOLVE_ATTEMPTS");
    expect(hook).toContain("MAX_VERIFY_ATTEMPTS");
  });

  it("does not cancel an in-flight drain when the theme provider rerenders", () => {
    expect(hook).toContain("activeClubThemeRef.current = activeClubTheme");
    expect(hook).toContain("setActiveClubThemeRef.current = setActiveClubTheme");
    expect(hook).toContain("drainRequestedRef.current = true");
    expect(hook).toMatch(/\}, \[user\?\.id\]\);/);
  });
});

describe("membership verification covers team-scoped roles", () => {
  const src = readFileSync("src/hooks/useNotificationClubSwitch.ts", "utf8");

  it("unions user_roles.club_id with user_roles.team_id -> teams.club_id", () => {
    expect(src).toContain('.eq("club_id", clubId)');
    expect(src).toContain('teams!inner(club_id)');
    expect(src).toContain('.not("team_id", "is", null)');
  });

  it("distinguishes a failed lookup from a non-member so the switch can retry", () => {
    expect(src).toContain('return "error"');
    expect(src).toContain('=== "error"');
  });
});
