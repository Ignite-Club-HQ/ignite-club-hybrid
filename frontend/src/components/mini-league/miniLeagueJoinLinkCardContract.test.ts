import { describe, expect, it } from "vitest";
import {
  buildMiniLeagueJoinLinkQrFilename,
  buildMiniLeagueJoinLinkUrl,
  MINI_LEAGUE_ADMIN_JOIN_LINK_COPY,
  MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE,
  MINI_LEAGUE_PARENT_JOIN_LINK_COPY,
  MINI_LEAGUE_PARENT_JOIN_LINK_ROLE,
  requireAuthenticatedUserId,
} from "./miniLeagueJoinLinkCardContract";

describe("mini-league join-link role contract", () => {
  it("keeps the admin and parent roles, metadata, and copy distinct", () => {
    expect(MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE).toMatchObject({
      role: "league_admin",
      metadataKind: "league_admin_join_link",
    });
    expect(MINI_LEAGUE_PARENT_JOIN_LINK_ROLE).toMatchObject({
      role: "parent",
      metadataKind: "mini_league_parent_join_link",
    });

    expect(MINI_LEAGUE_ADMIN_JOIN_LINK_COPY.description("Summer League")).toContain("League Admin");
    expect(MINI_LEAGUE_PARENT_JOIN_LINK_COPY.description("Summer League")).toContain("add their child");
    expect(MINI_LEAGUE_ADMIN_JOIN_LINK_COPY.generateLabel).not.toBe(
      MINI_LEAGUE_PARENT_JOIN_LINK_COPY.generateLabel,
    );
  });

  it("preserves link generation and QR filename conventions", () => {
    expect(buildMiniLeagueJoinLinkUrl("token-123")).toBe(
      "https://reference.invalid/join/p/token-123",
    );
    expect(buildMiniLeagueJoinLinkQrFilename("parent-join", "Summer League!")).toBe(
      "parent-join-summer-league-.png",
    );
  });

  it("requires an authenticated actor before role-specific mutations", () => {
    expect(() => requireAuthenticatedUserId(null)).toThrow("Not signed in");
    expect(requireAuthenticatedUserId("user-1")).toBe("user-1");
  });
});
