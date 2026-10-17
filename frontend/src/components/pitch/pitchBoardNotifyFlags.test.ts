import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPitchNotifyFlags } from "./pitchBoardNotifyFlags";
const m = vi.hoisted(() => ({ from: vi.fn(), flags: vi.fn() }));
const icp = process.env.IGNITE_TEST_BACKEND_MODE === "icp";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => icp ? "icp" : "supabase" }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: async (_: string, p: { icp: (ctx: unknown) => unknown }) => p.icp({}) }));
vi.mock("@/live/features/club", () => ({ getLiveTeamPitchNotify: m.flags }));
beforeEach(() => { vi.clearAllMocks(); });
describe("pitch role notification preferences", () => {
  it.runIf(icp)("reads disabled coach and Subs Manager preferences from the canister, never Supabase", async () => {
    m.flags.mockResolvedValue({ coach: false, team_admin: true, subs_manager: false });
    expect(await loadPitchNotifyFlags("team-1")).toEqual({ coach: false, team_admin: true, subs_manager: false });
    expect(m.flags).toHaveBeenCalledWith({}, "team-1");
    expect(m.from).not.toHaveBeenCalled();
  });
  it("event groups retain all role defaults without a team-settings read", async () => {
    expect(await loadPitchNotifyFlags("event-group-1")).toEqual({ coach: true, team_admin: true, subs_manager: true });
    expect(m.flags).not.toHaveBeenCalled();
    expect(m.from).not.toHaveBeenCalled();
  });
});