/**
 * Notification taps for a different club must move the global club filter, and
 * must never guess: unresolvable or non-club-scoped targets leave it alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: Record<string, any> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          // Assign an Error to rows[table] to simulate a failed lookup (the
          // cold-start race: RLS rejects the query before the session restores).
          maybeSingle: async () => rows[table] instanceof Error
            ? { data: null, error: rows[table] }
            : { data: rows[table] ?? null, error: null },
        }),
      }),
    }),
  },
}));

import {
  resolveNotificationClubId,
  requestClubSwitchForNotification,
  peekPendingNotificationClubSwitch,
  peekPendingNotificationClubSwitchRequest,
  consumePendingNotificationClubSwitch,
  stashResolvedNotificationClubSwitch,
  clearPendingNotificationClubSwitch,
  isNotificationClubSwitchInFlight,
  clearNotificationClubSwitchInFlight,
} from "@/lib/notificationClubSwitch";

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  clearPendingNotificationClubSwitch();
  clearNotificationClubSwitchInFlight();
});


describe("resolveNotificationClubId", () => {
  it("prefers an explicit club_id from the payload", async () => {
    const id = await resolveNotificationClubId({ type: "team_message", club_id: "club-B", team_id: "t1", message_id: "m1" }, "/messages/t1?message=m1");
    expect(id).toBe("club-B");
  });

  it("resolves a team message to its club", async () => {
    rows.teams = { club_id: "club-B" };
    const id = await resolveNotificationClubId({ type: "team_message", message_id: "m1" }, "/messages/t1?message=m1");
    expect(id).toBe("club-B");
  });

  it("resolves a group message to its club", async () => {
    rows.chat_groups = { club_id: "club-C" };
    const id = await resolveNotificationClubId({ type: "group_message", message_id: "m1" }, "/groups/g1?message=m1");
    expect(id).toBe("club-C");
  });

  it("uses the club id directly for club messages", async () => {
    const id = await resolveNotificationClubId({ type: "club_message", message_id: "m1" }, "/messages/club/club-D?message=m1");
    expect(id).toBe("club-D");
  });

  it("returns null for DMs (not club-scoped)", async () => {
    const id = await resolveNotificationClubId({ type: "direct_message", message_id: "m1" }, "/messages/dm/c1?message=m1");
    expect(id).toBeNull();
  });

  it("returns null when a personal group has no club", async () => {
    rows.chat_groups = { club_id: null };
    const id = await resolveNotificationClubId({ type: "group_message", message_id: "m1" }, "/groups/g1?message=m1");
    expect(id).toBeNull();
  });
});

describe("requestClubSwitchForNotification", () => {
  it("stashes the resolved club for the provider to apply", async () => {
    rows.teams = { club_id: "club-B" };
    requestClubSwitchForNotification({ type: "team_message", message_id: "m1" }, "/messages/t1?message=m1");
    await new Promise((r) => setTimeout(r, 0));
    expect(peekPendingNotificationClubSwitch()).toBe("club-B");
  });

  it("stashes nothing when the club can't be determined", async () => {
    requestClubSwitchForNotification({ type: "direct_message", message_id: "m1" }, "/messages/dm/c1?message=m1");
    await new Promise((r) => setTimeout(r, 0));
    expect(peekPendingNotificationClubSwitch()).toBeNull();
  });
});

describe("non-chat notification urls", () => {
  it("resolves an event notification to the event's club", async () => {
    rows.events = { club_id: "club-E" };
    const id = await resolveNotificationClubId({ type: "event_invite" }, "/events/ev1");
    expect(id).toBe("club-E");
  });

  it("resolves a club-scoped url directly", async () => {
    expect(await resolveNotificationClubId({ type: "club_join" }, "/clubs/club-F")).toBe("club-F");
    expect(await resolveNotificationClubId({ type: "reward_available" }, "/clubs/club-G/rewards")).toBe("club-G");
    expect(await resolveNotificationClubId({ type: "fees" }, "/pay-fees/club-H")).toBe("club-H");
  });

  it("resolves a team url to its club", async () => {
    rows.teams = { club_id: "club-I" };
    expect(await resolveNotificationClubId({ type: "team_invite" }, "/teams/t9")).toBe("club-I");
  });

  it("resolves a media photo notification via the photo row", async () => {
    rows.photos = { club_id: "club-J", team_id: null };
    expect(await resolveNotificationClubId({ type: "photo_uploaded" }, "/media?photo=p1")).toBe("club-J");
  });

  it("falls back to a payload team_id when the url is not club-scoped", async () => {
    rows.teams = { club_id: "club-K" };
    expect(await resolveNotificationClubId({ type: "pitch_board", team_id: "t3" }, "/notifications")).toBe("club-K");
  });

  it("returns null for routes that are not club-owned", async () => {
    expect(await resolveNotificationClubId({ type: "points_awarded" }, "/profile?section=points-history")).toBeNull();
  });
});

describe("raw request survives tap-time lookup failure (cold-start race)", () => {
  it("keeps the raw request stashed so the hook can resolve it once auth is ready", async () => {
    rows.teams = new Error("network down");
    requestClubSwitchForNotification({ type: "team_message", message_id: "m1" }, "/messages/t1?message=m1");
    await new Promise((r) => setTimeout(r, 0));
    // No club resolved yet — but the REQUEST must not be dropped.
    expect(peekPendingNotificationClubSwitch()).toBeNull();
    const req = peekPendingNotificationClubSwitchRequest();
    expect(req?.clubId).toBeNull();
    expect(req?.url).toBe("/messages/t1?message=m1");
    expect((req?.data as any)?.message_id).toBe("m1");
  });

  it("a deferred re-resolution upgrades the raw request to a resolved switch", async () => {
    rows.teams = new Error("network down");
    requestClubSwitchForNotification({ type: "team_message", message_id: "m1" }, "/messages/t1?message=m1");
    await new Promise((r) => setTimeout(r, 0));
    // Auth/network recovers — the hook re-resolves and upgrades the stash.
    rows.teams = { club_id: "club-B" };
    const req = peekPendingNotificationClubSwitchRequest();
    const clubId = await resolveNotificationClubId(req?.data, req?.url);
    expect(clubId).toBe("club-B");
    stashResolvedNotificationClubSwitch(clubId!, req?.data, req?.url);
    expect(peekPendingNotificationClubSwitch()).toBe("club-B");
    expect(isNotificationClubSwitchInFlight("club-B")).toBe(true);
  });

  it("stashes no request at all for DMs (nothing club-scoped to resolve)", async () => {
    requestClubSwitchForNotification({ type: "direct_message", message_id: "m1" }, "/messages/dm/c1?message=m1");
    await new Promise((r) => setTimeout(r, 0));
    expect(peekPendingNotificationClubSwitchRequest()).toBeNull();
    expect(peekPendingNotificationClubSwitch()).toBeNull();
  });

  it("shields the route from the club scope guard while a raw request is unresolved", async () => {
    rows.teams = new Error("network down");
    requestClubSwitchForNotification({ type: "team_message", message_id: "m1" }, "/messages/t1?message=m1");
    await new Promise((r) => setTimeout(r, 0));
    // Club unknown yet — the guard must stand down for ANY club, or it would
    // bounce the tapped chat home while the filter is still on the old club.
    expect(isNotificationClubSwitchInFlight("any-club")).toBe(true);
  });

  it("consuming a raw request clears it", async () => {
    rows.teams = new Error("network down");
    requestClubSwitchForNotification({ type: "team_message", message_id: "m1" }, "/messages/t1?message=m1");
    await new Promise((r) => setTimeout(r, 0));
    expect(consumePendingNotificationClubSwitch()).toBeNull();
    expect(peekPendingNotificationClubSwitchRequest()).toBeNull();
  });
});

describe("in-flight switch marker", () => {
  it("is set as soon as a switch is stashed and cleared explicitly", async () => {
    rows.events = { club_id: "club-L" };
    requestClubSwitchForNotification({ type: "event_invite" }, "/events/ev2");
    await new Promise((r) => setTimeout(r, 0));
    expect(peekPendingNotificationClubSwitch()).toBe("club-L");
    expect(isNotificationClubSwitchInFlight("club-L")).toBe(true);
    expect(isNotificationClubSwitchInFlight("club-other")).toBe(false);
    clearNotificationClubSwitchInFlight();
    expect(isNotificationClubSwitchInFlight("club-L")).toBe(false);
  });
});
