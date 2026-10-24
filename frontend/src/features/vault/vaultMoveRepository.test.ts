import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ folders: vi.fn(), team: vi.fn(), from: vi.fn(), scope: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_f: string, p: { icp: (ctx: unknown) => unknown }, scope: unknown) => { mocks.scope(scope); return p.icp({}); } }));
vi.mock("@/live/features/vault", () => ({ listLiveVaultFolders: mocks.folders }));
vi.mock("@/live/features/club", () => ({ getLiveTeam: mocks.team }));
import { fetchVaultMoveFolders } from "./vaultMoveRepository";

describe("ICP Vault move destinations", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.folders.mockResolvedValue([]); });
  it("reads the exact club's on-chain folders without Supabase", async () => {
    await fetchVaultMoveFolders("club-a", null);
    expect(mocks.scope).toHaveBeenCalledWith({ clubId: "club-a" });
    expect(mocks.folders).toHaveBeenCalledWith({}, "club-a", null);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("resolves a team-only destination through the authorized team scope", async () => {
    mocks.team.mockResolvedValue([{ club_id: "club-a" }]);
    await fetchVaultMoveFolders(null, "team-a");
    expect(mocks.scope).toHaveBeenCalledWith({ teamId: "team-a" });
    expect(mocks.folders).toHaveBeenCalledWith({}, "club-a", "team-a");
  });
  it("preserves failed folder reads instead of treating them as empty", async () => {
    mocks.folders.mockRejectedValueOnce(new Error("unavailable"));
    await expect(fetchVaultMoveFolders("club-a", null)).rejects.toThrow("unavailable");
  });
  it("performs no reads without scope", async () => {
    expect(await fetchVaultMoveFolders(null, null)).toEqual([]);
    expect(mocks.folders).not.toHaveBeenCalled();
  });
});