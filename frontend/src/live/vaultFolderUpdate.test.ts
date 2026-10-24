import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("./domains", () => ({
  connectLiveVaultDomain: async () => ({ actor: { get_folder: mocks.get, get_competition_folder: mocks.get, update_folder: mocks.update } }),
  connectLivePiiAccessControl: vi.fn(),
}));
vi.mock("./piiVetKeys", () => ({ encryptPiiValue: vi.fn(), fetchPiiVetKeys: vi.fn() }));
import { updateLiveVaultFolder } from "./features/vault";
import type { FeatureBackendContext } from "./featureRouter";

describe("Vault folder rename permissions", () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue({ Ok: [{ restricted_roles: ["committee"], sort_order: 4, description: ["Private"], color: ["green"] }] });
    mocks.update.mockReset().mockResolvedValue({ Ok: {} });
  });
  const ctx = {} as FeatureBackendContext;
  it("preserves committee-only access and existing metadata when renaming", async () => {
    await updateLiveVaultFolder(ctx, "folder-a", "Minutes");
    expect(mocks.update).toHaveBeenCalledWith("folder-a", "Minutes", ["committee"], 4, ["Private"], ["green"]);
  });
  it("allows an explicit restriction change without changing unrelated metadata", async () => {
    await updateLiveVaultFolder(ctx, "folder-a", "Minutes", ["club_admin"]);
    expect(mocks.update).toHaveBeenCalledWith("folder-a", "Minutes", ["club_admin"], 4, ["Private"], ["green"]);
  });
  it("never updates after a denied or missing folder read", async () => {
    mocks.get.mockResolvedValue({ Ok: [] });
    await expect(updateLiveVaultFolder(ctx, "folder-a", "Minutes")).rejects.toThrow("not found");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});