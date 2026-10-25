import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ board: vi.fn(), roles: vi.fn() }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: async (_feature: string, p: { icp: (ctx: unknown) => unknown }, scope: unknown) => p.icp({ scope }) }));
vi.mock("@/live/membershipRouting", () => ({ readMembershipInScope: async (_ctx: unknown, scope: unknown, read: (ctx: unknown) => unknown) => read({ scope }) }));
vi.mock("@/live/features/membership", () => ({ getLiveMyRoleGrants: async () => [{ team: ["team"] }], listLiveTeamRoleGrants: m.roles }));
vi.mock("@/live/features/events", () => ({ getLiveActiveGame: m.board }));
vi.mock("@/live/features/club", () => ({ getLiveTeam: async () => [{ id: "team", club_id: "club", name: "Team" }], getLiveClubProfile: async () => [{ sport: ["soccer"] }] }));
import { readIcpActiveBoards } from "./activeBoardPicker";
beforeEach(() => { vi.clearAllMocks(); m.roles.mockResolvedValue([]); m.board.mockResolvedValue([{ id: "internal-game", is_active: true, updated_at_ms: 1n, pitch_state_json: "{}", timer_state_json: "{}" }]); });
describe("ICP board attachment discovery", () => {
  it("shares the team key used by the existing authorized viewer", async () => {
    const rows = await readIcpActiveBoards("team");
    expect(rows[0].id).toBe("team");
    expect(m.board).toHaveBeenCalledWith({ scope: { teamId: "team" } }, "team");
    expect(m.roles).toHaveBeenCalledWith({ scope: { teamId: "team" } }, "team");
  });
  it("does not retrieve board contents when membership is denied", async () => {
    m.roles.mockRejectedValue(new Error("membership revoked"));
    await expect(readIcpActiveBoards("team")).rejects.toThrow("membership revoked");
    expect(m.board).not.toHaveBeenCalled();
  });
});