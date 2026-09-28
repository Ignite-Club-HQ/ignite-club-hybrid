import { describe, expect, it } from "vitest";
import { mediaKeys } from "./mediaQueryKeys";

describe("mediaKeys", () => {
  it("preserves the complete feed identity across scope, date and chat-card filters", () => {
    expect(mediaKeys.feed({
      userId: "user-a",
      clubId: "club-a",
      teamId: "team-a",
      eventId: "event-a",
      dateFrom: "2026-08-01T00:00:00.000Z",
      dateTo: "2026-08-31T23:59:59.999Z",
      cardId: "card-a",
      cardPhotoIdsSignature: "photo-a,photo-b",
    })).toEqual([
      "photos", "user-a", "club-a", "team-a", "event-a",
      "2026-08-01T00:00:00.000Z", "2026-08-31T23:59:59.999Z",
      "card-a", "photo-a,photo-b",
    ]);
  });

  it("keeps broad user feed invalidation separate from one exact feed", () => {
    expect(mediaKeys.feeds("user-a")).toEqual(["photos", "user-a"]);
  });

  it("preserves bucketed engagement keys and their user prefixes", () => {
    expect(mediaKeys.reactionsBucket("user-a", 2)).toEqual(["photo-reactions", "user-a", 2]);
    expect(mediaKeys.reactions("user-a")).toEqual(["photo-reactions", "user-a"]);
    expect(mediaKeys.commentsBucket("user-a", 2)).toEqual(["photo-comments", "user-a", 2]);
    expect(mediaKeys.comments("user-a")).toEqual(["photo-comments", "user-a"]);
  });

  it("preserves both scoped and broad Pro-access identities", () => {
    expect(mediaKeys.proAccess()).toEqual(["has-pro-access"]);
    expect(mediaKeys.proAccessFor("user-a")).toEqual(["has-pro-access", "user-a"]);
    expect(mediaKeys.proAccessFor("user-a", "club-a", "team-a", "active-club-a")).toEqual([
      "has-pro-access", "user-a", "club-a", "team-a", "active-club-a",
    ]);
  });

  it("gives each active-club entitlement check a distinct cache identity", () => {
    const clubAKey = mediaKeys.proAccessFor("user-a", "club-a,club-b", "team-a", "club-a");
    const clubBKey = mediaKeys.proAccessFor("user-a", "club-a,club-b", "team-a", "club-b");
    const unfilteredKey = mediaKeys.proAccessFor("user-a", "club-a,club-b", "team-a", null);

    expect(clubAKey).not.toEqual(clubBKey);
    expect(clubAKey).not.toEqual(unfilteredKey);
    expect(unfilteredKey).toEqual([
      "has-pro-access", "user-a", "club-a,club-b", "team-a", null,
    ]);
  });
});
