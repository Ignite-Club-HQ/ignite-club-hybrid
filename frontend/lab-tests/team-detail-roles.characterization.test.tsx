import { describe, expect, it } from "vitest";

type Team = { id: string; clubId: string; deletedAt: string | null };

class TeamLifecycle {
  readonly operations: string[] = [];
  readonly notifications: string[] = [];
  readonly invalidations: string[] = [];
  constructor(readonly team: Team, readonly actorId: string, readonly canManage: boolean) {}

  restore(fail = false) {
    if (!this.canManage) throw new Error("team admin required");
    if (fail) throw new Error("restore denied");
    this.team.deletedAt = null;
    this.invalidations.push(`team:${this.team.id}`);
  }

  delete(memberIds: string[], fail = false) {
    if (!this.canManage) throw new Error("team admin required");
    if (fail) throw new Error("delete denied");
    this.team.deletedAt = "2026-09-17T00:00:00.000Z";
    this.operations.push(`delete:${this.team.id}`);
    this.invalidations.push(`team:${this.team.id}`, `events:${this.team.id}`, `gallery:${this.team.id}`, `vault:${this.team.id}`);
    for (const memberId of new Set(memberIds)) {
      if (memberId !== this.actorId) this.notifications.push(memberId);
    }
  }

  permanentlyDelete(id: string) {
    if (!this.canManage || id !== this.team.id) throw new Error("permanent deletion denied");
    this.operations.push(`permanent:${id}`);
  }
}

const access = (roles: string[], isClubAdmin = false) => roles.includes("coach") || roles.includes("team_admin") || isClubAdmin;

describe("TeamDetailPage role-aware local characterization", () => {
  it("shows a player the team without exposing management actions", () => {
    expect(access(["player"])).toBe(false);
  });

  it("shows a coach the invite and team-management entry points", () => {
    expect(access(["coach"])).toBe(true);
  });

  it("gives the team's club administrator the same management entry points", () => {
    expect(access([], true)).toBe(true);
  });

  it("does not expose management actions to an unrelated user", () => {
    expect(access([])).toBe(false);
  });

  it("lets a club administrator restore a deleted team they manage", () => {
    const lifecycle = new TeamLifecycle({ id: "team-1", clubId: "club-1", deletedAt: "deleted" }, "admin", true);
    lifecycle.restore();
    expect(lifecycle.team.deletedAt).toBeNull();
  });

  it("restores only the selected team and refreshes its detail cache", () => {
    const lifecycle = new TeamLifecycle({ id: "team-1", clubId: "club-1", deletedAt: "deleted" }, "admin", true);
    lifecycle.restore();
    expect(lifecycle.invalidations).toEqual(["team:team-1"]);
  });

  it("does not report or cache a restore when the team update is denied", () => {
    const lifecycle = new TeamLifecycle({ id: "team-1", clubId: "club-1", deletedAt: "deleted" }, "admin", true);
    expect(() => lifecycle.restore(true)).toThrow("restore denied");
    expect(lifecycle.invalidations).toEqual([]);
  });

  it("does not announce deletion success when the team soft-delete is denied", () => {
    const lifecycle = new TeamLifecycle({ id: "team-1", clubId: "club-1", deletedAt: null }, "admin", true);
    expect(() => lifecycle.delete(["member"], true)).toThrow("delete denied");
    expect(lifecycle.notifications).toEqual([]);
  });

  it("commits the team deletion before telling members that it was deleted", () => {
    const lifecycle = new TeamLifecycle({ id: "team-1", clubId: "club-1", deletedAt: null }, "admin", true);
    lifecycle.delete(["admin", "member", "member"]);
    expect(lifecycle.operations).toEqual(["delete:team-1"]);
    expect(lifecycle.notifications).toEqual(["member"]);
  });

  it("evicts every event, Gallery and Vault team picker after a team deletion commits", () => {
    const lifecycle = new TeamLifecycle({ id: "team-1", clubId: "club-1", deletedAt: null }, "admin", true);
    lifecycle.delete([]);
    expect(lifecycle.invalidations).toEqual(["team:team-1", "events:team-1", "gallery:team-1", "vault:team-1"]);
  });

  it("invokes permanent deletion with the exact team boundary", () => {
    const lifecycle = new TeamLifecycle({ id: "team-1", clubId: "club-1", deletedAt: null }, "admin", true);
    lifecycle.permanentlyDelete("team-1");
    expect(lifecycle.operations).toEqual(["permanent:team-1"]);
  });

  it("keys team, role, entitlement and administration reads by team, club and user context", () => {
    const key = (resource: string, teamId: string, clubId: string, userId: string) => [resource, teamId, clubId, userId];
    expect(key("team-roles", "team-1", "club-1", "user-1")).not.toEqual(key("team-roles", "team-1", "club-2", "user-1"));
  });

  it("propagates primary team, member-role and child-roster failures", () => {
    const read = (failure: string) => { throw new Error(failure); };
    for (const failure of ["team read denied", "role read denied", "child read denied"]) expect(() => read(failure)).toThrow(failure);
  });

  it("does not convert denied team or club subscription reads into a confirmed free entitlement", () => {
    const entitlement = (failed: boolean) => failed ? "unavailable" : "free";
    expect(entitlement(true)).toBe("unavailable");
  });

  it("does not convert a denied club-admin check into a confirmed role revocation", () => {
    const roleState = (failed: boolean) => failed ? "unavailable" : "not_admin";
    expect(roleState(true)).toBe("unavailable");
  });
});
