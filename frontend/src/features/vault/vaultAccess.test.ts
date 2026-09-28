import { describe, expect, it } from "vitest";
import {
  canAccessVault,
  getVaultAdminUpgradeInfo,
  getVaultTeamIds,
  hasVaultProEntitlement,
  hasVaultRoleAccess,
  isVaultClubAdminOrCommittee,
  isVaultCoachOrTeamAdmin,
  resolveVaultContextPro,
} from "./vaultAccess";

const clubView = { type: "club", clubId: "club-a", clubName: "Club A" } as const;
const teamView = {
  type: "team",
  clubId: "club-a",
  clubName: "Club A",
  teamId: "team-a",
  teamName: "Team A",
} as const;

describe("Vault access rules", () => {
  it("allows only established Vault roles unless the user is an app admin", () => {
    expect(hasVaultRoleAccess(false, [{ role: "player" }])).toBe(false);
    expect(hasVaultRoleAccess(false, [{ role: "coach" }])).toBe(true);
    expect(hasVaultRoleAccess(false, [{ role: "committee_member" }])).toBe(true);
    expect(hasVaultRoleAccess(true, undefined)).toBe(true);
  });

  it("fails closed while roles are absent", () => {
    expect(hasVaultRoleAccess(false, undefined)).toBe(false);
    expect(hasVaultRoleAccess(false, null)).toBe(false);
  });

  it("isolates club-admin and committee access to the active club", () => {
    const roles = [
      { role: "club_admin", club_id: "club-b" },
      { role: "committee_member", club_id: "club-a" },
    ];
    expect(isVaultClubAdminOrCommittee(false, clubView, roles)).toBe(true);
    expect(isVaultClubAdminOrCommittee(false, { ...clubView, clubId: "club-c" }, roles)).toBe(false);
  });

  it("treats an app admin as privileged in every context, including root", () => {
    expect(isVaultClubAdminOrCommittee(true, { type: "root" }, [])).toBe(true);
  });

  it("isolates coach and team-admin visibility by club", () => {
    expect(isVaultCoachOrTeamAdmin(false, teamView, [
      { role: "team_admin", club_id: "club-a", team_id: "team-b" },
    ])).toBe(true);
    expect(isVaultCoachOrTeamAdmin(false, teamView, [
      { role: "coach", club_id: "club-b" },
    ])).toBe(false);
  });

  it("inherits coach visibility from the already resolved club-admin decision", () => {
    expect(isVaultCoachOrTeamAdmin(true, { type: "root" }, [])).toBe(true);
  });

  it("prefers a club-admin upgrade route over a team-admin route", () => {
    expect(getVaultAdminUpgradeInfo([
      { role: "team_admin", team_id: "team-a" },
      { role: "club_admin", club_id: "club-a" },
    ])).toEqual({ clubId: "club-a", teamId: undefined });
  });

  it("falls back to the first team-admin upgrade route", () => {
    expect(getVaultAdminUpgradeInfo([
      { role: "coach", team_id: "team-other" },
      { role: "team_admin", team_id: "team-a" },
    ])).toEqual({ clubId: undefined, teamId: "team-a" });
  });

  it("preserves team ids in role order without broadening or deduplicating them", () => {
    expect(getVaultTeamIds([
      { team_id: "team-a" },
      { team_id: null },
      { team_id: "team-a" },
      { team_id: "team-b" },
    ])).toEqual(["team-a", "team-a", "team-b"]);
  });

  it("recognises every supported Pro and administrative override flag", () => {
    expect(hasVaultProEntitlement({ is_pro: true })).toBe(true);
    expect(hasVaultProEntitlement({ is_pro_football: true })).toBe(true);
    expect(hasVaultProEntitlement({ admin_pro_override: true })).toBe(true);
    expect(hasVaultProEntitlement({ admin_pro_football_override: true })).toBe(true);
    expect(hasVaultProEntitlement({})).toBe(false);
    expect(hasVaultProEntitlement(null)).toBe(false);
  });

  it("lets a team inherit club Pro or use its own team Pro", () => {
    expect(resolveVaultContextPro(teamView, true, false)).toBe(true);
    expect(resolveVaultContextPro(teamView, false, true)).toBe(true);
    expect(resolveVaultContextPro(teamView, false, false)).toBe(false);
  });

  it("does not let team Pro grant club, league, or root context access", () => {
    expect(resolveVaultContextPro(clubView, false, true)).toBe(false);
    expect(resolveVaultContextPro({
      type: "mini-league",
      clubId: "club-a",
      clubName: "Club A",
      miniLeagueId: "league-a",
      miniLeagueName: "League A",
    }, false, true)).toBe(false);
    expect(resolveVaultContextPro({ type: "root" }, true, true)).toBe(false);
  });

  it("requires both a qualifying role and the relevant Pro context", () => {
    expect(canAccessVault({
      isAppAdmin: false,
      hasRoleAccess: true,
      hasAnyPro: true,
      currentContextHasPro: false,
      isRoot: true,
    })).toBe(true);
    expect(canAccessVault({
      isAppAdmin: false,
      hasRoleAccess: false,
      hasAnyPro: true,
      currentContextHasPro: true,
      isRoot: false,
    })).toBe(false);
    expect(canAccessVault({
      isAppAdmin: false,
      hasRoleAccess: true,
      hasAnyPro: true,
      currentContextHasPro: false,
      isRoot: false,
    })).toBe(false);
  });

  it("lets app admins bypass Pro but not the resolved role-access contract", () => {
    expect(canAccessVault({
      isAppAdmin: true,
      hasRoleAccess: true,
      hasAnyPro: false,
      currentContextHasPro: false,
      isRoot: false,
    })).toBe(true);
    expect(canAccessVault({
      isAppAdmin: true,
      hasRoleAccess: false,
      hasAnyPro: false,
      currentContextHasPro: false,
      isRoot: false,
    })).toBe(false);
  });
});
