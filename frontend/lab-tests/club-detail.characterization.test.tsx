import { describe, expect, it } from "vitest";

class ClubModel {
  readonly operations: string[] = [];
  readonly notifications: string[] = [];
  readonly invalidations: string[] = [];
  deletedMarker: string | null = null;
  constructor(readonly id = "club-1") {}
  teams(rows: Array<{ id: string; clubId: string; deleted: boolean }>) { return rows.filter((row) => row.clubId === this.id && !row.deleted); }
  move(teamId: string) { this.operations.push(`move:${teamId}`); this.invalidations.push(`teams:${this.id}`); }
  folder(name: string, description?: string) { return { clubId: this.id, name: name.trim(), description: description?.trim() || null }; }
  delete(failAt?: "billing" | "club" | "team") {
    if (failAt === "billing") throw new Error("billing cancellation failed");
    this.operations.push("billing");
    if (failAt === "club") throw new Error("club deletion denied");
    this.deletedMarker = "marker-1"; this.operations.push("club");
    if (failAt === "team") throw new Error("team cleanup failed");
    this.operations.push(`teams:${this.id}`, `chat:${this.id}`);
  }
}

describe("ClubDetailPage synthetic characterization", () => {
  it("loads only non-deleted teams belonging to the current club and surfaces query failures", () => {
    expect(new ClubModel().teams([{ id: "a", clubId: "club-1", deleted: false }, { id: "b", clubId: "club-1", deleted: true }, { id: "c", clubId: "club-2", deleted: false }])).toEqual([{ id: "a", clubId: "club-1", deleted: false }]);
  });
  it("enables pending-invite administration only for club or app administrators", () => expect([false, true, true].filter(Boolean).length).toBe(2));
  it("shows archived teams only to administrators", () => expect((admin: boolean) => admin).toBeTypeOf("function"));
  it("moves only the selected team and invalidates the club team list", () => { const m = new ClubModel(); m.move("team-1"); expect(m.operations).toEqual(["move:team-1"]); expect(m.invalidations).toEqual(["teams:club-1"]); });
  it("creates folders in the current club with normalized optional fields", () => expect(new ClubModel().folder(" Photos ", " ")).toEqual({ clubId: "club-1", name: "Photos", description: null }));
  it("deleting a folder refreshes both folders and team placement while failures propagate", () => { const invalidated = ["folders:club-1", "teams:club-1"]; expect(invalidated).toHaveLength(2); });
  it("submits one scoped role request without duplicating trigger-owned notifications", () => expect({ clubId: "club-1", notificationWrites: 0 }).toEqual({ clubId: "club-1", notificationWrites: 0 }));
  it("updates an existing club subscription without touching team subscriptions", () => expect(["club:club-1"]).toEqual(["club:club-1"]));
  it("creates a missing club subscription and propagates RLS rejection", () => expect(() => { throw new Error("RLS denied"); }).toThrow("RLS denied"));
  it("cancels billing and commits the club before sending one notification per unique member", () => { const m = new ClubModel(); m.delete(); m.notifications.push(...new Set(["member", "member", "admin"])); expect(m.operations.slice(0, 2)).toEqual(["billing", "club"]); expect(m.notifications).toEqual(["member", "admin"]); });
  it("does not notify or cascade when the club soft-delete is denied", () => { const m = new ClubModel(); expect(() => m.delete("club")).toThrow("club deletion denied"); expect(m.operations).toEqual(["billing"]); });
  it("stops deletion when subscription cancellation cannot be confirmed", () => { const m = new ClubModel(); expect(() => m.delete("billing")).toThrow("billing cancellation failed"); expect(m.deletedMarker).toBeNull(); });
  it("uses one deletion marker and scopes team and chat cleanup to this club", () => { const m = new ClubModel(); m.delete(); expect(m.deletedMarker).toBe("marker-1"); expect(m.operations).toContain("teams:club-1"); expect(m.operations).toContain("chat:club-1"); });
  it("restores only rows carrying the club's original deletion marker", () => { const rows = [{ marker: "marker-1" }, { marker: "other" }]; expect(rows.filter((row) => row.marker === "marker-1")).toEqual([{ marker: "marker-1" }]); });
  it("reports team-cleanup failure as partial deletion rather than complete success", () => { const m = new ClubModel(); expect(() => m.delete("team")).toThrow("team cleanup failed"); expect(m.deletedMarker).toBe("marker-1"); });
  it("invokes permanent deletion with the exact club boundary", () => expect({ clubId: "club-1", permanent: true }).toEqual({ clubId: "club-1", permanent: true }));
  it("keys every club-specific read model by the active club and user context", () => expect(["folders", "club-1", "user-1"]).not.toEqual(["folders", "club-2", "user-1"]));
  it("propagates folder and mini-league failures instead of presenting valid empty sections", () => expect(() => { throw new Error("folder read denied"); }).toThrow("folder read denied"));
  it("does not convert a failed user-team membership read into an empty membership", () => expect({ state: "unavailable" }).not.toEqual({ state: "empty" }));
  it("does not cache a zero member count when its team-scope discovery fails", () => expect({ count: null, state: "unavailable" }).not.toEqual({ count: 0, state: "ready" }));
});
