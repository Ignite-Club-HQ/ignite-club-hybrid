import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  icp: false,
  team: null as { id: string; name: string; club_id: string } | null,
  groupMeta: null as { clubId: string | null; teamId: string | null } | null,
  miniLeague: null as { club_id: string | null } | null,
  supabaseFrom: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.supabaseFrom },
}));

vi.mock("@/lib/icpClubTeamLookup", () => ({
  isIcpSession: () => mocks.icp,
  icpGetTeam: async () => mocks.team,
  icpGetClubName: async () => null,
  icpListTeams: async () => [],
  icpListClubs: async () => [],
  icpCtx: async () => ({}),
}));

vi.mock("@/live/features/messaging", () => ({
  getLiveGroupMetadata: async () => {
    if (!mocks.groupMeta) throw new Error("no metadata");
    return mocks.groupMeta;
  },
}));

vi.mock("@/live/features/miniLeagues", () => ({
  getLiveMiniLeague: async () => {
    if (!mocks.miniLeague) throw new Error("no league");
    return mocks.miniLeague;
  },
}));

import { lookupRouteClubId } from "@/lib/clubScopeLookup";

describe("lookupRouteClubId (ICP mode)", () => {
  beforeEach(() => {
    mocks.icp = true;
    mocks.team = null;
    mocks.groupMeta = null;
    mocks.miniLeague = null;
    mocks.supabaseFrom.mockReset();
  });

  it("resolves a group chat's owning club from canister metadata without touching Supabase", async () => {
    mocks.groupMeta = { clubId: "club-1", teamId: null };
    await expect(lookupRouteClubId("chat_groups", "g1")).resolves.toBe("club-1");
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
  });

  it("falls back through the team when the group has no club", async () => {
    mocks.groupMeta = { clubId: null, teamId: "team-9" };
    mocks.team = { id: "team-9", name: "T", club_id: "club-2" };
    await expect(lookupRouteClubId("chat_groups", "g1")).resolves.toBe("club-2");
  });

  it("resolves teams and mini-leagues from the canisters", async () => {
    mocks.team = { id: "team-1", name: "T", club_id: "club-3" };
    await expect(lookupRouteClubId("teams", "team-1")).resolves.toBe("club-3");
    mocks.miniLeague = { club_id: "club-4" };
    await expect(lookupRouteClubId("mini_leagues", "ml-1")).resolves.toBe("club-4");
  });

  it("fails open to null when the canister read errors", async () => {
    mocks.groupMeta = null; // mock throws
    await expect(lookupRouteClubId("chat_groups", "g1")).resolves.toBeNull();
  });

  it("fails open to null for tables without a single-row ICP reader", async () => {
    await expect(lookupRouteClubId("events", "e1")).resolves.toBeNull();
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
  });
});
