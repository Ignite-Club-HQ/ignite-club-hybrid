import { beforeEach, describe, expect, it, vi } from "vitest";

describe("rolesCache", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));
  });

  it("matches roles only within the requested club or team scope", async () => {
    const cache = await import("./rolesCache");
    cache.cacheRoles([
      { id: "1", role: "club_admin", club_id: "club-a", team_id: null },
      { id: "2", role: "team_admin", club_id: null, team_id: "team-b" },
    ]);

    expect(cache.isCachedClubAdmin("club-a")).toBe(true);
    expect(cache.isCachedClubAdmin("club-b")).toBe(false);
    expect(cache.isCachedTeamAdmin("team-b")).toBe(true);
    expect(cache.isCachedTeamAdmin("team-a")).toBe(false);
  });

  it("distinguishes a cache miss from a permission denial", async () => {
    const cache = await import("./rolesCache");
    expect(cache.isCachedAppAdmin()).toBeNull();
    cache.cacheRoles([]);
    expect(cache.isCachedAppAdmin()).toBe(false);
  });

  it("uses fresh roles for 30 minutes and stale fallback for at most four hours", async () => {
    const cache = await import("./rolesCache");
    cache.cacheRoles([{ id: "1", role: "coach", club_id: "c", team_id: "t" }]);

    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(cache.getCachedRoles({ allowStale: false })).toBeNull();
    expect(cache.getCachedRoles()).toHaveLength(1);
    expect(cache.rolesNeedRefresh()).toBe(true);

    vi.advanceTimersByTime(3.5 * 60 * 60 * 1000);
    expect(cache.getCachedRoles()).toBeNull();
  });

  it("removes persisted permissions when invalidated", async () => {
    const cache = await import("./rolesCache");
    cache.cacheRoles([{ id: "1", role: "app_admin", club_id: null, team_id: null }]);
    vi.advanceTimersByTime(500);
    expect(localStorage.getItem("ignite_user_roles_cache")).not.toBeNull();

    cache.clearRolesCache();
    expect(cache.getCachedRoles()).toBeNull();
    expect(localStorage.getItem("ignite_user_roles_cache")).toBeNull();
  });
});
