import { describe, expect, it, vi } from "vitest";
import {
  fetchPendingInviteByToken,
  fetchTeamInviteByToken,
} from "./inviteTokenRepository";

describe("invite token repository", () => {
  it("resolves the first pending invite row through the secure token RPC", async () => {
    const row = { id: "pending-1", role: "committee_member" };
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    await expect(fetchPendingInviteByToken({ rpc }, "token-1")).resolves.toBe(row);
    expect(rpc).toHaveBeenCalledWith("get_pending_invite_by_token", { _token: "token-1" });
  });

  it("distinguishes a valid empty token result from an RPC failure", async () => {
    await expect(fetchPendingInviteByToken({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    }, "missing")).resolves.toBeNull();
    const failure = new Error("invite denied");
    await expect(fetchPendingInviteByToken({
      rpc: vi.fn().mockResolvedValue({ data: null, error: failure }),
    }, "bad")).rejects.toBe(failure);
  });

  it("normalizes a team invite without losing club, usage or child metadata", async () => {
    const rpcRow = {
      id: "invite-1", team_id: "team-1", role: "parent", token: "token-1",
      uses_count: 2, max_uses: 5, expires_at: "2026-12-01T00:00:00Z",
      created_at: "2026-08-01T00:00:00Z", created_by: "admin-1",
      metadata: { child_name: "Alex", child_year_of_birth: 2017 },
      team_name: "U10 Blue", team_logo_url: "team.png", club_id: "club-1",
      club_name: "Riverside FC",
    };
    const rpc = vi.fn().mockResolvedValue({ data: [rpcRow], error: null });
    await expect(fetchTeamInviteByToken({ rpc }, "token-1")).resolves.toEqual({
      id: "invite-1", team_id: "team-1", role: "parent", token: "token-1",
      uses_count: 2, max_uses: 5, expires_at: "2026-12-01T00:00:00Z",
      created_at: "2026-08-01T00:00:00Z", created_by: "admin-1",
      metadata: { child_name: "Alex", child_year_of_birth: 2017 },
      teams: {
        id: "team-1", name: "U10 Blue", logo_url: "team.png", club_id: "club-1",
        clubs: { name: "Riverside FC", logo_url: undefined },
      },
    });
    expect(rpc).toHaveBeenCalledWith("get_team_invite_by_token", { _token: "token-1" });
  });

  it("returns null for an unknown team token and propagates RPC failures", async () => {
    await expect(fetchTeamInviteByToken({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }, "missing")).resolves.toBeNull();
    const failure = { message: "expired", code: "P0001" };
    await expect(fetchTeamInviteByToken({
      rpc: vi.fn().mockResolvedValue({ data: null, error: failure }),
    }, "expired")).rejects.toBe(failure);
  });
});
