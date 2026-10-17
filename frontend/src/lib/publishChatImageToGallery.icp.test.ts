import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Force every call through the ICP branch regardless of auth/routing state.
vi.mock("@/live/featureRouter", async () => {
  const actual = await vi.importActual<typeof import("@/live/featureRouter")>("@/live/featureRouter");
  return {
    ...actual,
    withFeatureBackend: (_feature: string, providers: any) =>
      providers.icp({ identity: {} as never, target: {} as never }),
  };
});

const state: {
  assets: Array<{ id: string; blob_ref: Array<{ path: string; canister: string; content_hash: string }> }>;
  registered: any[];
  scoped: any[];
  nextAssetId: string;
} = {
  assets: [],
  registered: [],
  scoped: [],
  nextAssetId: "asset-1",
};

vi.mock("@/live/features/media", () => ({
  listLiveAssets: vi.fn(async (_ctx: unknown, _clubId: string) => state.assets),
  registerLiveAsset: vi.fn(async (_ctx: unknown, input: any) => {
    state.registered.push(input);
    return { id: state.nextAssetId };
  }),
  setLiveAssetScope: vi.fn(async (_ctx: unknown, assetId: string, scope: any) => {
    state.scoped.push({ assetId, scope });
    return {};
  }),
  deleteLiveAsset: vi.fn(),
}));

const secure = vi.hoisted(() => ({ unlock: vi.fn(), upload: vi.fn() }));
vi.mock("@/live/mediaDecrypt", () => ({ resolveIcpBlobObjectUrl: secure.unlock }));
vi.mock("@/live/mediaUpload", () => ({ tryUploadMediaToBlobStore: secure.upload }));

import { publishChatImageToGallery } from "./publishChatImageToGallery";

const originalFetch = globalThis.fetch;
const BLOB_URL = "https://abc123-canister.raw.icp0.io/clubs/c1/photo.jpg";

function stubFetch(blob: Blob, ok = true, status = 200) {
  globalThis.fetch = vi.fn(async () => ({ ok, status, blob: async () => blob })) as any;
}

beforeEach(() => {
  state.assets = [];
  state.registered = [];
  state.scoped = [];
  secure.unlock.mockReset().mockResolvedValue("blob:authorized-photo");
  secure.upload.mockReset().mockResolvedValue({ url: "https://store.raw.icp0.io/gallery-copy", blobRef: {
    canister: "gallery-store", path: "gallery-copy", content_hash: "encrypted-hash",
  } });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("publishChatImageToGallery (ICP)", () => {
  it("unlocks and copies the image under gallery encryption before registering its scope", async () => {
    stubFetch(new Blob(["hi"], { type: "image/jpeg" }));

    const result = await publishChatImageToGallery({
      imageUrl: BLOB_URL,
      uploaderId: "u1",
      teamId: "t1",
      clubId: "c1",
      caption: "hello",
      albumId: "album-1",
    });

    expect(result.alreadyPublished).toBe(false);
    expect(result.photoId).toBe("asset-1");

    expect(state.registered).toHaveLength(1);
    expect(state.registered[0]).toMatchObject({
      clubId: "c1",
      kind: "photo",
      storagePath: expect.stringMatching(/^clubs\/c1\/gallery\/chat-/),
      blobRef: { canister: "gallery-store", path: "gallery-copy", content_hash: "encrypted-hash" },
    });
    expect(secure.unlock).toHaveBeenCalledWith(BLOB_URL);
    expect(globalThis.fetch).toHaveBeenCalledWith("blob:authorized-photo");
    expect(secure.upload).toHaveBeenCalledWith(expect.objectContaining({ lock: "club", mime: "image/jpeg" }));

    expect(state.scoped).toHaveLength(1);
    expect(state.scoped[0]).toMatchObject({
      assetId: "asset-1",
      scope: { teamId: "t1", caption: "hello", albumId: "album-1" },
    });
  });

  it("is idempotent: returns the existing asset instead of re-registering when the blob_ref already exists", async () => {
    state.assets = [
      { id: "existing-asset", blob_ref: [{ path: "/clubs/c1/photo.jpg", canister: "abc123-canister", content_hash: "x" }] },
    ];
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const result = await publishChatImageToGallery({
      imageUrl: BLOB_URL,
      uploaderId: "u1",
      teamId: "t1",
      clubId: "c1",
    });

    expect(result).toEqual({ photoId: "existing-asset", alreadyPublished: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.registered).toHaveLength(0);
  });

  it("requires a clubId on the ICP backend (chat is club/team scoped, not a bare teamId)", async () => {
    await expect(
      publishChatImageToGallery({ imageUrl: BLOB_URL, uploaderId: "u1", teamId: "t1", clubId: null }),
    ).rejects.toThrow(/club/i);
  });

  it("fails with a friendly error when the image URL is not a recognised blob-store URL", async () => {
    await expect(
      publishChatImageToGallery({
        imageUrl: "https://example.com/not-a-blob.jpg",
        uploaderId: "u1",
        teamId: "t1",
        clubId: "c1",
      }),
    ).rejects.toThrow(/cannot be published/);
  });

  it("removes the registered gallery row and reports failure if audience scoping fails", async () => {
    stubFetch(new Blob(["hi"], { type: "image/jpeg" }));
    const media = await import("@/live/features/media");
    (media.setLiveAssetScope as any).mockRejectedValueOnce(new Error("has no update method set_asset_scope"));

    await expect(publishChatImageToGallery({
      imageUrl: BLOB_URL,
      uploaderId: "u1",
      teamId: "t1",
      clubId: "c1",
    })).rejects.toThrow("has no update method set_asset_scope");
    expect(media.deleteLiveAsset).toHaveBeenCalledWith(expect.anything(), "asset-1");
  });

  it("does not upload or register when the source image cannot be decrypted", async () => {
    secure.unlock.mockRejectedValue(new Error("Access denied"));
    await expect(publishChatImageToGallery({ imageUrl: BLOB_URL, uploaderId: "u1", teamId: "t1", clubId: "c1" })).rejects.toThrow("Could not load the image");
    expect(secure.upload).not.toHaveBeenCalled();
    expect(state.registered).toHaveLength(0);
  });
});
