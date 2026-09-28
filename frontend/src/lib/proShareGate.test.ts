import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, maybeSingle, eq, select, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { maybeSingle, eq, select };
});

const mockSupabase = await vi.hoisted(async () => {
  const { createMockSupabaseClient } = await import("@/test/mockSupabaseClient");
  return createMockSupabaseClient();
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: mockSupabase }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { checkProForShare } from "./proShareGate";

describe("checkProForShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingle.mockResolvedValue({ data: null });
    mockSupabase.from.mockReturnValue({ select });
  });

  it("denies when no club or team scope is supplied", async () => {
    await expect(checkProForShare({})).resolves.toEqual({ allowed: false, clubId: null });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("allows an entitled team and resolves its club for upgrade routing", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: true });
    maybeSingle.mockResolvedValueOnce({ data: { club_id: "club-1" } });

    await expect(checkProForShare({ teamId: "team-1" })).resolves.toEqual({
      allowed: true,
      clubId: "club-1",
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith("has_active_pro_for_team", { _team_id: "team-1" });
  });

  it("falls back from a non-Pro team to its Pro club", async () => {
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

  it("fails closed when the entitlement check throws", async () => {
    mockSupabase.rpc.mockRejectedValueOnce(new Error("network"));
    await expect(checkProForShare({ clubId: "club-1" })).resolves.toEqual({
      allowed: false,
      clubId: "club-1",
    });
  });
});
