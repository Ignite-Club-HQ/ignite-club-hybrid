import { describe, it, expect } from "vitest";
import { resolveRouteClubScope } from "@/lib/routeClubScope";

describe("resolveRouteClubScope", () => {
  it("resolves club id directly from club-prefixed routes", () => {
    expect(resolveRouteClubScope("/clubs/abc")).toEqual({ kind: "direct", clubId: "abc" });
    expect(resolveRouteClubScope("/clubs/abc/seasons")).toEqual({ kind: "direct", clubId: "abc" });
    expect(resolveRouteClubScope("/messages/club/abc")).toEqual({ kind: "direct", clubId: "abc" });
    expect(resolveRouteClubScope("/pay-fees/abc")).toEqual({ kind: "direct", clubId: "abc" });
  });

  it("looks up owning club for entity routes", () => {
    expect(resolveRouteClubScope("/teams/t1")).toEqual({ kind: "lookup", table: "teams", id: "t1" });
    expect(resolveRouteClubScope("/messages/t1")).toEqual({ kind: "lookup", table: "teams", id: "t1" });
    expect(resolveRouteClubScope("/groups/g1")).toEqual({ kind: "lookup", table: "chat_groups", id: "g1" });
    expect(resolveRouteClubScope("/events/e1")).toEqual({ kind: "lookup", table: "events", id: "e1" });
    expect(resolveRouteClubScope("/mini-leagues/m1")).toEqual({ kind: "lookup", table: "mini_leagues", id: "m1" });
    expect(resolveRouteClubScope("/vault/folder/f1")).toEqual({ kind: "lookup", table: "vault_folders", id: "f1" });
    expect(resolveRouteClubScope("/messages/club-admin/c1")).toEqual({
      kind: "lookup",
      table: "club_admin_conversations",
      id: "c1",
    });
  });

  it("scopes DMs by the other participant's clubs", () => {
    expect(resolveRouteClubScope("/messages/dm/c1")).toEqual({ kind: "dm", conversationId: "c1" });
    expect(resolveRouteClubScope("/messages/dm")).toEqual({ kind: "none" });
  });

  it("leaves cross-club, personal and creation routes unscoped", () => {
    for (const p of [
      "/",
      "/events",
      "/events/new",
      "/messages",
      "/messages/broadcast",
      "/messages/welcome",
      "/vault",
      "/media",
      "/leaderboard",
      "/clubs",
      "/clubs/new",
      "/teams/new",
      "/associations/x",
      "/admin/users",
      "/profile",
      "/settings",
    ]) {
      expect(resolveRouteClubScope(p), p).toEqual({ kind: "none" });
    }
  });
});
