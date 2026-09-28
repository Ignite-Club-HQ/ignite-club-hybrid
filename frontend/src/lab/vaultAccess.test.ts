import { describe, expect, it } from "vitest";
import {
  hasVaultRoleAccess,
  mergeVaultTeamClubIds,
  resolveVaultVisibleClubIds,
} from "./vaultAccess";

describe("Vault club-access resolution (lab)", () => {
  it("lets an app admin bypass role checks entirely (app-admin)", () => {
    expect(hasVaultRoleAccess(true, undefined)).toBe(true);
    expect(hasVaultRoleAccess(true, [])).toBe(true);
    expect(hasVaultRoleAccess(true, [{ role: "player" }])).toBe(true);
    // A non-admin still needs a qualifying role - app-admin is the only
    // unconditional bypass.
    expect(hasVaultRoleAccess(false, [{ role: "player" }])).toBe(false);
  });

  it("unions a direct club role with clubs reached via team membership", () => {
    const roles = [
      { club_id: "club-a", team_id: null },
      { club_id: null, team_id: "team-a" },
    ];
    // "team-a" resolves to club-b via the caller's own teams lookup.
    expect(resolveVaultVisibleClubIds(roles, ["club-b"])).toEqual(["club-a", "club-b"]);
  });

  it("does not require a team lookup result to already include direct club ids", () => {
    const roles = [{ club_id: "club-a", team_id: "team-a" }];
    expect(resolveVaultVisibleClubIds(roles, ["club-a"])).toEqual(["club-a"]);
  });

  it("takes the empty-role fast path without needing a team lookup", () => {
    expect(resolveVaultVisibleClubIds(null, ["club-a"])).toEqual([]);
    expect(resolveVaultVisibleClubIds(undefined)).toEqual([]);
    expect(resolveVaultVisibleClubIds([], ["club-a"])).toEqual([]);
  });

  it("deduplicates repeated direct and team-derived club ids", () => {
    const roles = [
      { club_id: "club-a", team_id: "team-a" },
      { club_id: "club-a", team_id: "team-b" },
    ];
    expect(resolveVaultVisibleClubIds(roles, ["club-b", "club-b", null, undefined])).toEqual([
      "club-a",
      "club-b",
    ]);
  });

  it("leaves an already-empty club id list unchanged when there is nothing to merge", () => {
    expect(mergeVaultTeamClubIds([], [])).toEqual([]);
    expect(mergeVaultTeamClubIds([], null)).toEqual([]);
    expect(mergeVaultTeamClubIds([], undefined)).toEqual([]);
  });
});
