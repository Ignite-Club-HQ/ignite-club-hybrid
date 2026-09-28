import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingleResults: Record<string, any> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: maybeSingleResults[table] ?? null }),
        }),
      }),
    }),
  },
}));

import { resolvePointsNotificationClubId, isPointsNotificationType } from "./pointsNotificationClub";

describe("resolvePointsNotificationClubId", () => {
  beforeEach(() => {
    delete maybeSingleResults.events;
    delete maybeSingleResults.clubs;
  });

  it("prefers the explicit club_id on the notification", async () => {
    const clubId = await resolvePointsNotificationClubId({ club_id: "club-a", related_id: "event-1" });
    expect(clubId).toBe("club-a");
  });

  it("falls back to the related event's club", async () => {
    maybeSingleResults.events = { club_id: "club-b" };
    const clubId = await resolvePointsNotificationClubId({ related_id: "event-1" });
    expect(clubId).toBe("club-b");
  });

  it("falls back to the related id when it is a club", async () => {
    maybeSingleResults.clubs = { id: "club-c" };
    const clubId = await resolvePointsNotificationClubId({ related_id: "club-c" });
    expect(clubId).toBe("club-c");
  });

  it("returns null when nothing resolves (never guess a club)", async () => {
    expect(await resolvePointsNotificationClubId({ related_id: "unknown" })).toBeNull();
    expect(await resolvePointsNotificationClubId({})).toBeNull();
  });

  it("recognises points notification types", () => {
    expect(isPointsNotificationType("early_rsvp_points")).toBe(true);
    expect(isPointsNotificationType("event_reminder")).toBe(false);
  });
});
