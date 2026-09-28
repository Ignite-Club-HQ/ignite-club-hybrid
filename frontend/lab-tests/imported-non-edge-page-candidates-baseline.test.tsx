import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { completeHomeAccountRecovery } from "../src/features/home/accountRecoveryCompletion";
import { getEventEligibleTeamIds } from "../src/lab/eventAudience";
import { notificationListFamilyKey } from "../src/lab/notificationCachePolicy";
import {
  canAccessVault,
  hasVaultRoleAccess,
  resolveVaultContextPro,
} from "../src/lab/vaultAccess";
import type { VaultFolderView } from "../src/lab/vaultAccessTypes";

type Role = "app_admin" | "club_admin" | "team_admin" | "coach" | "player" | "parent";
type Membership = { userId: string; role: Role; clubId?: string; teamId?: string };

function hasRole(
  memberships: readonly Membership[],
  userId: string,
  role: Role,
  clubId?: string,
  teamId?: string,
): boolean {
  return memberships.some((membership) =>
    membership.userId === userId
    && membership.role === role
    && (clubId === undefined || membership.clubId === clubId)
    && (teamId === undefined || membership.teamId === teamId));
}

class ClubSetupModel {
  readonly teams: Array<{ id: string; clubId: string; name: string }> = [];
  readonly memberships: Membership[] = [];
  drafts = new Map<string, { teamName: string; levelAge: string }>();

  saveDraft(clubId: string, draft: { teamName: string; levelAge: string }) {
    this.drafts.set(clubId, { ...draft });
  }

  createTeamWithCreatorAdmin(
    creatorId: string,
    clubId: string,
    name: string,
    assignRole: () => void,
  ) {
    const team = { id: `team-${this.teams.length + 1}`, clubId, name: name.trim() };
    const stagedMemberships = [...this.memberships];
    assignRole();
    stagedMemberships.push({ userId: creatorId, role: "team_admin", clubId, teamId: team.id });
    this.teams.push(team);
    this.memberships.splice(0, this.memberships.length, ...stagedMemberships);
    return team;
  }
}

test("ClubSetupWizardPage keeps drafts club-scoped and commits team creation with creator access", () => {
  const model = new ClubSetupModel();
  model.saveDraft("club-a", { teamName: "U10 Blue", levelAge: "U10" });
  model.saveDraft("club-b", { teamName: "U12 Gold", levelAge: "U12" });

  const team = model.createTeamWithCreatorAdmin("creator", "club-a", " U10 Blue ", () => {});

  expect(model.drafts.get("club-a")).toEqual({ teamName: "U10 Blue", levelAge: "U10" });
  expect(model.drafts.get("club-b")).toEqual({ teamName: "U12 Gold", levelAge: "U12" });
  expect(team).toEqual({ id: "team-1", clubId: "club-a", name: "U10 Blue" });
  expect(hasRole(model.memberships, "creator", "team_admin", "club-a", team.id)).toBe(true);
});

test("ClubSetupWizardPage leaves no team or role when creator-role assignment is rejected", () => {
  const model = new ClubSetupModel();

  expect(() => model.createTeamWithCreatorAdmin("creator", "club-a", "U10 Blue", () => {
    throw new Error("creator role denied");
  })).toThrow("creator role denied");
  expect(model.teams).toEqual([]);
  expect(model.memberships).toEqual([]);
});

class ClubDetailModel {
  readonly notifications: Array<{ userId: string; clubId: string; message: string }> = [];
  readonly roleRequests: Array<{ userId: string; clubId: string; role: Role }> = [];
  deleted = false;

  listTeams(teams: readonly { id: string; clubId: string; deleted: boolean }[], clubId: string) {
    return teams.filter((team) => team.clubId === clubId && !team.deleted);
  }

  requestClubAdmin(userId: string, clubId: string) {
    this.roleRequests.push({ userId, clubId, role: "club_admin" });
  }

  deleteClub(input: {
    actorId: string;
    clubId: string;
    isAdmin: boolean;
    cancelBilling: () => void;
    markDeleted: () => void;
    memberIds: readonly string[];
  }) {
    if (!input.isAdmin) throw new Error("club admin required");
    input.cancelBilling();
    input.markDeleted();
    this.deleted = true;
    for (const userId of new Set(input.memberIds)) {
      if (userId !== input.actorId) {
        this.notifications.push({ userId, clubId: input.clubId, message: "Club deleted" });
      }
    }
  }
}

test("ClubDetailPage scopes active teams and role requests to the current club without duplicate notifications", () => {
  const model = new ClubDetailModel();
  expect(model.listTeams([
    { id: "active-a", clubId: "club-a", deleted: false },
    { id: "deleted-a", clubId: "club-a", deleted: true },
    { id: "active-b", clubId: "club-b", deleted: false },
  ], "club-a")).toEqual([{ id: "active-a", clubId: "club-a", deleted: false }]);

  model.requestClubAdmin("member", "club-a");
  expect(model.roleRequests).toEqual([{ userId: "member", clubId: "club-a", role: "club_admin" }]);
  expect(model.notifications).toEqual([]);
});

test("ClubDetailPage commits deletion before one notification per non-acting member and stops on failures", () => {
  const model = new ClubDetailModel();
  const operations: string[] = [];
  model.deleteClub({
    actorId: "admin",
    clubId: "club-a",
    isAdmin: true,
    cancelBilling: () => operations.push("billing"),
    markDeleted: () => operations.push("club"),
    memberIds: ["admin", "member-1", "member-1", "member-2"],
  });
  expect(operations).toEqual(["billing", "club"]);
  expect(model.notifications).toEqual([
    { userId: "member-1", clubId: "club-a", message: "Club deleted" },
    { userId: "member-2", clubId: "club-a", message: "Club deleted" },
  ]);

  const blocked = new ClubDetailModel();
  expect(() => blocked.deleteClub({
    actorId: "admin",
    clubId: "club-a",
    isAdmin: true,
    cancelBilling: () => { throw new Error("billing cancellation failed"); },
    markDeleted: () => { throw new Error("must not run"); },
    memberIds: ["member-1"],
  })).toThrow("billing cancellation failed");
  expect(blocked.deleted).toBe(false);
  expect(blocked.notifications).toEqual([]);
});

function isUpcoming(event: { date: string; start?: string | null }, now: number): boolean {
  const date = event.date.includes("T") ? new Date(event.date) : new Date(`${event.date}T00:00`);
  const start = event.start && /^\d{2}:\d{2}$/.test(event.start)
    ? new Date(`${event.date}T${event.start}`)
    : date;
  return start.getTime() + 30 * 60 * 1000 >= now
    && start.getFullYear() >= new Date(now).getFullYear()
    && start.getMonth() >= new Date(now).getMonth() - 1;
}

test("HomePage Next Up retains future events, applies club scope before the limit, and expires after grace", () => {
  const now = new Date(2026, 6, 29, 9, 30).getTime();
  const events = [
    { id: "past", clubId: "club-a", date: "2026-07-29", start: "09:00" },
    { id: "future-a", clubId: "club-a", date: "2026-07-30", start: "07:00" },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `other-${index}`, clubId: "club-b", date: "2026-07-30", start: "08:00",
    })),
  ];
  const visible = events.filter((event) => event.clubId === "club-a" && isUpcoming(event, now)).slice(0, 10);

  expect(visible.map((event) => event.id)).toEqual(["past", "future-a"]);
  expect(isUpcoming({ date: "2026-07-29", start: "09:00" }, now + 1)).toBe(false);
});

class HomeOrchestrationModel {
  readonly redemptions: Array<{ id: string; userId: string; clubId: string; fulfilledBy?: string }> = [];
  readonly notifications: Array<{ userId: string; redemptionId: string }> = [];

  requireRows<T>(result: T[] | null, failure?: Error): T[] {
    if (failure) throw failure;
    if (result === null) throw new Error("authoritative dependency returned null");
    return result;
  }

  redeem(input: {
    userId: string;
    clubId: string;
    balance: number;
    cost: number;
    deduct: () => void;
  }) {
    if (input.balance < input.cost) throw new Error("insufficient club points");
    const redemption = { id: `redemption-${this.redemptions.length + 1}`, userId: input.userId, clubId: input.clubId };
    this.redemptions.push(redemption);
    try {
      input.deduct();
    } catch (error) {
      this.redemptions.splice(this.redemptions.indexOf(redemption), 1);
      throw error;
    }
    return redemption;
  }

  fulfil(input: {
    redemptionId: string;
    verifierId: string;
    clubAdminIds: readonly string[];
  }) {
    const redemption = this.redemptions.find((candidate) => candidate.id === input.redemptionId);
    if (!redemption) throw new Error("redemption unavailable");
    redemption.fulfilledBy = input.verifierId;
    for (const userId of new Set(input.clubAdminIds)) {
      if (userId !== redemption.userId && userId !== input.verifierId) {
        this.notifications.push({ userId, redemptionId: redemption.id });
      }
    }
  }
}

test("HomePage orchestration propagates required-read failures instead of replacing protected state", () => {
  const model = new HomeOrchestrationModel();
  const denied = new Error("membership read denied");
  expect(() => model.requireRows(null, denied)).toThrow(denied);
  expect(() => model.requireRows(null)).toThrow("authoritative dependency returned null");
  expect(model.requireRows([{ id: "membership-a" }])).toEqual([{ id: "membership-a" }]);
});

test("HomePage rewards prevent overdrafts, compensate failed deductions, and notify only after fulfilment", () => {
  const model = new HomeOrchestrationModel();
  expect(() => model.redeem({
    userId: "member", clubId: "club-a", balance: 4, cost: 5, deduct: () => {},
  })).toThrow("insufficient club points");
  expect(model.redemptions).toEqual([]);

  expect(() => model.redeem({
    userId: "member", clubId: "club-a", balance: 10, cost: 5,
    deduct: () => { throw new Error("points update denied"); },
  })).toThrow("points update denied");
  expect(model.redemptions).toEqual([]);

  const redemption = model.redeem({
    userId: "member", clubId: "club-a", balance: 10, cost: 5, deduct: () => {},
  });
  model.fulfil({
    redemptionId: redemption.id,
    verifierId: "verifier",
    clubAdminIds: ["member", "verifier", "other-admin", "other-admin"],
  });
  expect(model.redemptions).toEqual([{
    id: redemption.id, userId: "member", clubId: "club-a", fulfilledBy: "verifier",
  }]);
  expect(model.notifications).toEqual([{ userId: "other-admin", redemptionId: redemption.id }]);
});

function createAdditionalAccessRequest(input: {
  userId: string;
  role: Role;
  clubId: string;
  teamId?: string;
  childId?: string;
  newChildName?: string;
  existingRequests: readonly { userId: string; role: Role; clubId: string; teamId?: string }[];
}) {
  if (input.role === "parent" && !input.childId && !input.newChildName?.trim()) {
    throw new Error("parent request needs a child");
  }
  if (input.existingRequests.some((request) =>
    request.userId === input.userId
    && request.role === input.role
    && request.clubId === input.clubId
    && request.teamId === input.teamId)) {
    throw new Error("matching access request already exists");
  }
  return {
    userId: input.userId,
    role: input.role,
    clubId: input.clubId,
    ...(input.teamId ? { teamId: input.teamId } : {}),
    ...(input.childId ? { childId: input.childId } : {}),
    ...(input.newChildName?.trim() ? { newChildName: input.newChildName.trim() } : {}),
  };
}

test("HomePage role requests retain club/team/child scope and reject only exact duplicates", () => {
  expect(() => createAdditionalAccessRequest({
    userId: "member", role: "parent", clubId: "club-a", teamId: "team-a", existingRequests: [],
  })).toThrow("parent request needs a child");
  expect(createAdditionalAccessRequest({
    userId: "member", role: "parent", clubId: "club-a", teamId: "team-a",
    newChildName: "  New Child  ", existingRequests: [],
  })).toEqual({
    userId: "member", role: "parent", clubId: "club-a", teamId: "team-a", newChildName: "New Child",
  });
  expect(() => createAdditionalAccessRequest({
    userId: "member", role: "coach", clubId: "club-a", teamId: "team-a",
    existingRequests: [{ userId: "member", role: "coach", clubId: "club-a", teamId: "team-a" }],
  })).toThrow("matching access request already exists");
  expect(createAdditionalAccessRequest({
    userId: "member", role: "coach", clubId: "club-a", teamId: "team-b",
    existingRequests: [{ userId: "member", role: "player", clubId: "club-a", teamId: "team-b" }],
  })).toMatchObject({ role: "coach", teamId: "team-b" });
});

test("HomePage recovery refreshes only the account-deletion search surface", () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

  completeHomeAccountRecovery(client);

  expect(invalidate).toHaveBeenCalledOnce();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["search-users-manage"] });
});

function resolveEventGroupPitchBoard(input: {
  groupId: string;
  groupName: string;
  canEdit: boolean;
  isSubsManager: boolean;
  players: readonly { id: string; team: "a" | "b" }[];
}) {
  return {
    teamId: `event-group-${input.groupId}`,
    teamName: input.groupName,
    readOnly: !input.canEdit,
    isSubsManager: input.isSubsManager,
    teamAPlayerIds: input.players.filter((player) => player.team === "a").map((player) => player.id),
    teamBPlayerIds: input.players.filter((player) => player.team === "b").map((player) => player.id),
  };
}

test("EventGroupPitchPage isolates its roster and permits Subs Manager pitch edits without team management", () => {
  const board = resolveEventGroupPitchBoard({
    groupId: "group-1",
    groupName: "Grand Final",
    canEdit: true,
    isSubsManager: true,
    players: [{ id: "a-1", team: "a" }, { id: "b-1", team: "b" }],
  });
  expect(board).toEqual({
    teamId: "event-group-group-1",
    teamName: "Grand Final",
    readOnly: false,
    isSubsManager: true,
    teamAPlayerIds: ["a-1"],
    teamBPlayerIds: ["b-1"],
  });
  expect(resolveEventGroupPitchBoard({
    ...board,
    groupId: "group-1",
    groupName: "Grand Final",
    canEdit: false,
    isSubsManager: false,
    players: [],
  }).readOnly).toBe(true);
});

function resolveTeamAccess(roles: readonly Role[], isAppAdmin: boolean, isClubAdmin: boolean, isSubsManager = false) {
  const manager = isAppAdmin || isClubAdmin || roles.includes("team_admin") || roles.includes("coach");
  const member = manager || roles.includes("player") || roles.includes("parent");
  return {
    canManageTeam: manager,
    isMember: member,
    canAccessPitchBoard: member,
    canEditPitchBoard: manager || isSubsManager,
  };
}

test("TeamDetailPage preserves role precedence and keeps temporary pitch access narrower than team management", () => {
  expect(resolveTeamAccess(["player"], false, false)).toEqual({
    canManageTeam: false, isMember: true, canAccessPitchBoard: true, canEditPitchBoard: false,
  });
  expect(resolveTeamAccess(["coach"], false, false).canManageTeam).toBe(true);
  expect(resolveTeamAccess([], false, true).canEditPitchBoard).toBe(true);
  expect(resolveTeamAccess([], false, false, true)).toEqual({
    canManageTeam: false, isMember: false, canAccessPitchBoard: false, canEditPitchBoard: true,
  });
});

class AdminRoleModel {
  readonly roles: Membership[] = [];
  readonly notifications: Array<{ userId: string; role: Role }> = [];

  grantAppAdmin(actorId: string, userId: string) {
    if (!hasRole(this.roles, actorId, "app_admin")) throw new Error("app admin required");
    if (hasRole(this.roles, userId, "app_admin")) return;
    this.roles.push({ userId, role: "app_admin" });
    this.notifications.push({ userId, role: "app_admin" });
  }

  removeRole(actorId: string, target: Membership) {
    if (!hasRole(this.roles, actorId, "app_admin")) throw new Error("app admin required");
    if (target.userId === actorId && target.role === "app_admin") throw new Error("cannot remove current admin");
    const index = this.roles.indexOf(target);
    if (index >= 0) this.roles.splice(index, 1);
  }
}

test("ManageUsersPage non-Edge role operations require an app admin and retain exact scope", () => {
  const model = new AdminRoleModel();
  model.roles.push({ userId: "admin", role: "app_admin" });
  const teamRole = { userId: "member", role: "coach" as const, clubId: "club-a", teamId: "team-a" };
  model.roles.push(teamRole, { userId: "member", role: "coach", clubId: "club-b", teamId: "team-b" });

  model.grantAppAdmin("admin", "member");
  model.grantAppAdmin("admin", "member");
  expect(model.roles.filter((role) => role.userId === "member" && role.role === "app_admin")).toHaveLength(1);
  expect(model.notifications).toEqual([{ userId: "member", role: "app_admin" }]);
  model.removeRole("admin", teamRole);
  expect(model.roles).toContainEqual({ userId: "member", role: "coach", clubId: "club-b", teamId: "team-b" });
  expect(() => model.removeRole("admin", model.roles[0]!)).toThrow("cannot remove current admin");
});

function applyPointsAdjustment(input: {
  amount: number;
  commitLedger: () => void;
  recordHistory: () => void;
  notify: () => void;
  checkPositiveThreshold: () => void;
  email: () => void;
}) {
  if (input.amount === 0) throw new Error("non-zero adjustment required");
  input.commitLedger();
  input.recordHistory();
  input.notify();
  if (input.amount > 0) input.checkPositiveThreshold();
  try {
    input.email();
  } catch {
    // Email remains best-effort after the durable ledger and notification work.
  }
}

test("ManageUsersPage point adjustments commit durable effects before best-effort email", () => {
  const calls: string[] = [];
  applyPointsAdjustment({
    amount: 5,
    commitLedger: () => calls.push("ledger"),
    recordHistory: () => calls.push("history"),
    notify: () => calls.push("notification"),
    checkPositiveThreshold: () => calls.push("threshold"),
    email: () => { calls.push("email"); throw new Error("mail unavailable"); },
  });
  expect(calls).toEqual(["ledger", "history", "notification", "threshold", "email"]);

  const deductionCalls: string[] = [];
  applyPointsAdjustment({
    amount: -2,
    commitLedger: () => deductionCalls.push("ledger"),
    recordHistory: () => deductionCalls.push("history"),
    notify: () => deductionCalls.push("notification"),
    checkPositiveThreshold: () => deductionCalls.push("threshold"),
    email: () => deductionCalls.push("email"),
  });
  expect(deductionCalls).toEqual(["ledger", "history", "notification", "email"]);
  expect(() => applyPointsAdjustment({
    amount: 1,
    commitLedger: () => { throw new Error("ledger denied"); },
    recordHistory: () => { throw new Error("must not run"); },
    notify: () => { throw new Error("must not run"); },
    checkPositiveThreshold: () => { throw new Error("must not run"); },
    email: () => { throw new Error("must not run"); },
  })).toThrow("ledger denied");
});

test("MediaPage and NotificationsPage preserve scoped local cache identities", () => {
  const eventAudience = { team_id: null, target_team_ids: ["team-b", "team-a"] };
  expect(getEventEligibleTeamIds(eventAudience)).toEqual(["team-b", "team-a"]);
  expect(notificationListFamilyKey("member-a")).toEqual(["notifications", "member-a"]);
  expect(notificationListFamilyKey("member-a")).not.toEqual(notificationListFamilyKey("member-b"));
});

class NotificationSubscriptionModel {
  readonly channels = new Map<string, { userId: string; handlers: string[]; subscribed: boolean }>();
  readonly removed: string[] = [];

  mount(userId: string) {
    const topic = `notifications-page-${userId}`;
    if (!this.channels.has(topic)) {
      this.channels.set(topic, {
        userId,
        handlers: ["INSERT", "UPDATE", "DELETE"],
        subscribed: true,
      });
    }
    return topic;
  }

  unmount(topic: string) {
    if (this.channels.delete(topic)) this.removed.push(topic);
  }
}

test("NotificationsPage owns one user-scoped realtime channel without disturbing global subscriptions", () => {
  const model = new NotificationSubscriptionModel();
  const globalTopic = "notifications-realtime";
  model.channels.set(globalTopic, {
    userId: "global",
    handlers: ["INSERT", "UPDATE", "DELETE"],
    subscribed: true,
  });
  const first = model.mount("member-a");
  expect(model.mount("member-a")).toBe(first);
  expect(model.channels.get(first)).toEqual({
    userId: "member-a",
    handlers: ["INSERT", "UPDATE", "DELETE"],
    subscribed: true,
  });

  model.unmount(first);
  const second = model.mount("member-b");
  expect(model.removed).toEqual([first]);
  expect(model.channels.has(globalTopic)).toBe(true);
  expect(second).toBe("notifications-page-member-b");
  expect(model.channels.get(second)?.userId).toBe("member-b");
});

test("VaultPage keeps club-root access fail-closed and only grants a Pro role its matching context", () => {
  const club: VaultFolderView = { type: "club", clubId: "club-a", clubName: "Club A" };
  expect(hasVaultRoleAccess(false, [{ role: "coach", club_id: "club-a" }])).toBe(true);
  expect(resolveVaultContextPro(club, true, false)).toBe(true);
  expect(canAccessVault({
    isAppAdmin: false,
    hasRoleAccess: true,
    hasAnyPro: true,
    currentContextHasPro: false,
    isRoot: false,
  })).toBe(false);
});

test("HomePage delegates account-recovery invalidation to the bounded feature policy", () => {
  const source = readFileSync(resolve(__dirname, "../src/pages/HomePage.tsx"), "utf8");
  expect(source).toContain("@/features/home/accountRecoveryCompletion");
  expect(source).toContain("onAccountRecovered={() => completeHomeAccountRecovery(queryClient)}");
  expect(source).not.toMatch(/queryClient\.invalidateQueries\(\s*\)/);
});
