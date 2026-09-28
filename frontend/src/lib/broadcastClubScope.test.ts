import { describe, it, expect } from "vitest";
import { broadcastVisibleInClub, filterBroadcastsForClub } from "./broadcastClubScope";

describe("broadcastVisibleInClub", () => {
  it("shows untargeted announcements everywhere", () => {
    expect(broadcastVisibleInClub(null, "club-a")).toBe(true);
    expect(broadcastVisibleInClub([], null)).toBe(true);
  });

  it("fails closed when legacy cached targeting metadata is missing", () => {
    expect(broadcastVisibleInClub(undefined, "club-a")).toBe(false);
    expect(broadcastVisibleInClub(undefined, null)).toBe(false);
  });

  it("shows targeted announcements only in a targeted club", () => {
    expect(broadcastVisibleInClub(["club-a"], "club-a")).toBe(true);
    expect(broadcastVisibleInClub(["club-a"], "club-b")).toBe(false);
    expect(broadcastVisibleInClub(["club-a"], null)).toBe(false);
  });
});

describe("filterBroadcastsForClub", () => {
  it("drops rows targeted at other clubs", () => {
    const rows = [
      { id: "1", target_club_ids: null },
      { id: "2", target_club_ids: ["club-a"] },
      { id: "3", target_club_ids: ["club-b"] },
    ];
    expect(filterBroadcastsForClub(rows, "club-b").map((r) => r.id)).toEqual(["1", "3"]);
    expect(filterBroadcastsForClub(undefined, "club-b")).toEqual([]);
  });

  it("drops legacy rows that have no targeting metadata", () => {
    expect(filterBroadcastsForClub<{ id: string; target_club_ids?: string[] | null }>([{ id: "legacy" }], "club-a")).toEqual([]);
  });
});
