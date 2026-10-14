import { describe, expect, it, vi } from "vitest";

const isFeatureRoutedToIcp = vi.fn(() => true);
const listLiveVaultTrashWithFolder = vi.fn(async () => []);
const listLiveVaultClubFiles = vi.fn(async () => []);
const permanentlyDeleteLiveVaultFile = vi.fn(async () => ({}));
const getLiveVaultFile = vi.fn(async () => null);

vi.mock("@/live/loadBackendRouting", () => ({
  isFeatureRoutedToIcp,
  isSignedInWithEmail: () => false,
  getEffectiveBackendForFeature: () => "icp",
  tryGetActiveIcpTarget: () => ({ canisterIds: {} }),
}));

vi.mock("@/live/featureRouter", async () => {
  const actual = await vi.importActual<typeof import("@/live/featureRouter")>("@/live/featureRouter");
  return {
    ...actual,
    withFeatureBackend: (_feature: string, providers: any) =>
      providers.icp({ identity: {}, target: { canisterIds: {} } }),
  };
});

vi.mock("@/live/features/vault", () => ({
  listLiveVaultTrashWithFolder,
  listLiveVaultClubFiles,
  permanentlyDeleteLiveVaultFile,
  getLiveVaultFile,
}));

vi.mock("@/live/blobStoreUpload", () => ({ deleteBlobFromStore: vi.fn() }));
vi.mock("@/live/mediaStorage", () => ({ listBlobStoreKeys: () => [] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

describe("vault ICP routing (trash + large files)", () => {
  it("lists trash via the live vault_domain helper when ICP-routed", async () => {
    const { listLiveVaultTrashWithFolder: liveList } = await import("@/live/features/vault");
    const { withFeatureBackend } = await import("@/live/featureRouter");
    const result = await withFeatureBackend("vault", {
      supabase: () => {
        throw new Error("should not call supabase branch");
      },
      icp: async (ctx) => liveList(ctx, "club-1"),
    });
    expect(listLiveVaultTrashWithFolder).toHaveBeenCalledWith(expect.anything(), "club-1");
    expect(result).toEqual([]);
  });

  it("lists club files via the live vault_domain helper for the large-files view", async () => {
    const { listLiveVaultClubFiles: liveList } = await import("@/live/features/vault");
    const { withFeatureBackend } = await import("@/live/featureRouter");
    await withFeatureBackend("vault", {
      supabase: () => {
        throw new Error("should not call supabase branch");
      },
      icp: async (ctx) => liveList(ctx, "club-1", null, null),
    });
    expect(listLiveVaultClubFiles).toHaveBeenCalledWith(expect.anything(), "club-1", null, null);
  });

  it("routes permanent deletion through the live vault_domain delete when ICP-routed", async () => {
    const { permanentlyDeleteVaultItems } = await import("@/lib/vaultDelete");
    await permanentlyDeleteVaultItems({ fileIds: ["file-1"] });
    expect(permanentlyDeleteLiveVaultFile).toHaveBeenCalledWith(expect.anything(), "file-1");
  });
});
