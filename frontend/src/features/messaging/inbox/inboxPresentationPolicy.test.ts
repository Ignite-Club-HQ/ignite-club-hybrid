import { describe, expect, it } from "vitest";
import {
  resolveInboxEmptyState,
  resolveInboxGroupCreationCapability,
  resolveInboxUpgradePresentation,
} from "./inboxPresentationPolicy";

describe("resolveInboxGroupCreationCapability", () => {
  it("lets an app admin create groups without borrowing Pro state", () => {
    expect(resolveInboxGroupCreationCapability({ adminTeamCount: 0, adminClubCount: 0, isAppAdmin: true, isCommitteeMember: false, hasAnyProAccess: false }))
      .toEqual({ hasAdminRole: true, canCreateGroups: true });
  });

  it("requires definitive Pro access for team, club and committee administrators", () => {
    for (const role of [
      { adminTeamCount: 1, adminClubCount: 0, isCommitteeMember: false },
      { adminTeamCount: 0, adminClubCount: 1, isCommitteeMember: false },
      { adminTeamCount: 0, adminClubCount: 0, isCommitteeMember: true },
    ]) {
      expect(resolveInboxGroupCreationCapability({ ...role, isAppAdmin: false, hasAnyProAccess: undefined }).canCreateGroups).toBe(false);
      expect(resolveInboxGroupCreationCapability({ ...role, isAppAdmin: false, hasAnyProAccess: true }).canCreateGroups).toBe(true);
    }
  });

  it("does not grant creation capability from Pro access alone", () => {
    expect(resolveInboxGroupCreationCapability({ adminTeamCount: 0, adminClubCount: 0, isAppAdmin: false, isCommitteeMember: false, hasAnyProAccess: true }))
      .toEqual({ hasAdminRole: false, canCreateGroups: false });
  });
});

describe("resolveInboxEmptyState", () => {
  it("shows no-results only for a non-empty search with no unified rows", () => {
    const base = { teamCount: 0, memberClubCount: 0, visibleGroupCount: 0, directMessageCount: 0 };
    expect(resolveInboxEmptyState({ ...base, query: "grounds", unifiedConversationCount: 0 }).hasNoResults).toBe(true);
    expect(resolveInboxEmptyState({ ...base, query: "", unifiedConversationCount: 0 }).hasNoResults).toBe(false);
    expect(resolveInboxEmptyState({ ...base, query: "grounds", unifiedConversationCount: 1 }).hasNoResults).toBe(false);
  });

  it("treats any underlying messaging scope as a non-empty inbox", () => {
    const base = { query: "", unifiedConversationCount: 0, teamCount: 0, memberClubCount: 0, visibleGroupCount: 0, directMessageCount: 0 };
    expect(resolveInboxEmptyState(base).hasNoMessages).toBe(true);
    for (const key of ["teamCount", "memberClubCount", "visibleGroupCount", "directMessageCount"] as const) {
      expect(resolveInboxEmptyState({ ...base, [key]: 1 }).hasNoMessages).toBe(false);
    }
  });
});

const upgradeBase = {
  effectiveClubId: null,
  clubProStatuses: { free: false, pro: true },
  hasAnyProAccess: false,
  isProAccessLoading: false,
  isProAccessFetching: false,
  isClubProLoading: false,
  isClubProFetching: false,
  adminTeamCount: 1,
  adminClubs: [{ id: "free" }],
  memberClubs: [{ id: "member" }],
  isAppAdmin: false,
};

describe("resolveInboxUpgradePresentation", () => {
  it("does not flash an upgrade banner while either entitlement query is unresolved", () => {
    expect(resolveInboxUpgradePresentation({ ...upgradeBase, hasAnyProAccess: undefined }).hasAdminRoleButNoPro).toBe(false);
    expect(resolveInboxUpgradePresentation({ ...upgradeBase, clubProStatuses: undefined }).hasAdminRoleButNoPro).toBe(false);
    expect(resolveInboxUpgradePresentation({ ...upgradeBase, isClubProFetching: true }).hasAdminRoleButNoPro).toBe(false);
  });

  it("uses the selected club entitlement instead of another club's global Pro access", () => {
    const free = resolveInboxUpgradePresentation({ ...upgradeBase, effectiveClubId: "free", hasAnyProAccess: true });
    expect(free).toMatchObject({ scopedClubIsPro: false, hasAdminRoleButNoPro: true, upgradeClubId: "free" });
    const pro = resolveInboxUpgradePresentation({ ...upgradeBase, effectiveClubId: "pro", hasAnyProAccess: false });
    expect(pro).toMatchObject({ scopedClubIsPro: true, hasAdminRoleButNoPro: false, upgradeClubId: "pro" });
  });

  it("uses global any-Pro state only when no club is selected", () => {
    expect(resolveInboxUpgradePresentation({ ...upgradeBase, hasAnyProAccess: false }).hasAdminRoleButNoPro).toBe(true);
    expect(resolveInboxUpgradePresentation({ ...upgradeBase, hasAnyProAccess: true }).hasAdminRoleButNoPro).toBe(false);
  });

  it("never shows the upgrade banner to an app admin", () => {
    expect(resolveInboxUpgradePresentation({ ...upgradeBase, isAppAdmin: true }).hasAdminRoleButNoPro).toBe(false);
  });

  it("chooses the scoped club, then first admin club, then first member club as the upgrade target", () => {
    expect(resolveInboxUpgradePresentation({ ...upgradeBase, effectiveClubId: "selected" }).upgradeClubId).toBe("selected");
    expect(resolveInboxUpgradePresentation(upgradeBase).upgradeClubId).toBe("free");
    expect(resolveInboxUpgradePresentation({ ...upgradeBase, adminClubs: [], adminTeamCount: 1 }).upgradeClubId).toBe("member");
    expect(resolveInboxUpgradePresentation({ ...upgradeBase, adminClubs: [], memberClubs: [] }).upgradeClubId).toBeNull();
  });
});
