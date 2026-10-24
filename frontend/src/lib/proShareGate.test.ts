import { beforeEach, describe, expect, it, vi } from "vitest";

const { maybeSingle, eq, select } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { maybeSingle, eq, select };
});

const mockSupabase = await vi.hoisted(async () => {
  const { createMockSupabaseClient } = await import("@/test/mockSupabaseClient");
  return createMockSupabaseClient();
});
const icp = vi.hoisted(() => ({ allowance: vi.fn(), team: vi.fn() }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_feature: unknown, branches: any) => branches.icp({ target: {}, identity: {} }) }));
vi.mock('@/live/domains', () => ({ connectLiveClubDomain: async () => ({ actor: { get_media_allowance: icp.allowance } }) }));
vi.mock('@/live/features/club', () => ({ getLiveTeam: icp.team }));
const icpMode = process.env.IGNITE_TEST_BACKEND_MODE === "icp";
vi.mock("@/integrations/supabase/client", () => ({ supabase: mockSupabase }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => icpMode ? "icp" : "supabase" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { checkProForShare } from "./proShareGate";

describe("checkProForShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    icp.team.mockResolvedValue([]);
    icp.allowance.mockResolvedValue({ Ok: { premium: false } });
    maybeSingle.mockResolvedValue({ data: null });
    mockSupabase.from.mockReturnValue({ select });
  });

  it("denies when no club or team scope is supplied", async () => {
    await expect(checkProForShare({})).resolves.toEqual({ allowed: false, clubId: null });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it.runIf(!icpMode)("allows an entitled team and resolves its club for upgrade routing", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: true });
    maybeSingle.mockResolvedValueOnce({ data: { club_id: "club-1" } });

    await expect(checkProForShare({ teamId: "team-1" })).resolves.toEqual({
      allowed: true,
      clubId: "club-1",
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith("has_active_pro_for_team", { _team_id: "team-1" });
  });

  it.runIf(!icpMode)("falls back from a non-Pro team to its Pro club", async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: false })
      .mockResolvedValueOnce({ data: true });
    maybeSingle.mockResolvedValueOnce({ data: { club_id: "club-1" } });

    await expect(checkProForShare({ teamId: "team-1" })).resolves.toEqual({
      allowed: true,
      clubId: "club-1",
    });
    expect(mockSupabase.rpc).toHaveBeenLastCalledWith("has_active_pro_for_club", { _club_id: "club-1" });
  });

  it.runIf(!icpMode)("fails closed when the entitlement check throws", async () => {
    mockSupabase.rpc.mockRejectedValueOnce(new Error("network"));
    await expect(checkProForShare({ clubId: "club-1" })).resolves.toEqual({
      allowed: false,
      clubId: "club-1",
    });
  });

  it.runIf(icpMode)("uses the exact club/team allowance, never personal entitlement", async () => {
    icp.allowance.mockResolvedValue({ Ok: { premium: true } });
    await expect(checkProForShare({ clubId: 'club-1', teamId: 'team-1' })).resolves.toEqual({ allowed: true, clubId: 'club-1' });
    expect(icp.allowance).toHaveBeenCalledWith('club-1', ['team-1']);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
  it.runIf(icpMode)("refuses a failed authoritative allowance read", async () => {
    icp.allowance.mockResolvedValue({ Err: 'Foreign team' });
    await expect(checkProForShare({ clubId: 'club-1', teamId: 'team-2' })).resolves.toEqual({ allowed: false, clubId: 'club-1' });
  });
  it.runIf(icpMode)("fails closed without an ICP entitlement session and never queries Supabase", async () => {
    localStorage.removeItem("ignite_icp_internet_identity_session");
    await expect(checkProForShare({ teamId: "team-1" })).resolves.toEqual({
      allowed: false,
      clubId: null,
    });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
