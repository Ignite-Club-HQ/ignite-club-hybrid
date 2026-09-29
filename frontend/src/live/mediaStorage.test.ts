import { describe, expect, it } from "vitest";
import {
  blobAssetUrl,
  MEDIA_BLOB_STORE_KEY,
  resolveMediaSource,
  type LiveAssetLocation,
} from "./mediaStorage";

const supabaseAsset: LiveAssetLocation = {
  storage_path: "clubs/c1/photo.jpg",
};

const blobAsset: LiveAssetLocation = {
  storage_path: "clubs/c1/photo.jpg",
  blob_ref: [
    { canister: "aaaaa-aa", path: "/c1/photo.jpg", content_hash: "abc123" },
  ],
};

describe("resolveMediaSource", () => {
  it("resolves to Supabase storage when the asset has no blob_ref", () => {
    expect(resolveMediaSource(supabaseAsset)).toEqual({
      kind: "supabase",
      storagePath: "clubs/c1/photo.jpg",
    });
  });

  it("treats an empty Candid opt as no blob_ref", () => {
    expect(resolveMediaSource({ ...supabaseAsset, blob_ref: [] })).toEqual({
      kind: "supabase",
      storagePath: "clubs/c1/photo.jpg",
    });
  });

  it("resolves to an on-chain URL when a blob_ref is present", () => {
    expect(resolveMediaSource(blobAsset)).toEqual({
      kind: "icp-blob",
      canisterId: "aaaaa-aa",
      path: "/c1/photo.jpg",
      contentHash: "abc123",
      url: "https://icp0.io/aaaaa-aa/c1/photo.jpg",
    });
  });
});

describe("blobAssetUrl", () => {
  it("normalizes slashes and supports a custom gateway host", () => {
    expect(blobAssetUrl("aaaaa-aa", "c1/photo.jpg", "https://icp-api.io/")).toBe(
      "https://icp-api.io/aaaaa-aa/c1/photo.jpg",
    );
  });
});

describe("MEDIA_BLOB_STORE_KEY", () => {
  it("is the canister key admins configure in placement settings", () => {
    expect(MEDIA_BLOB_STORE_KEY).toBe("media_blob_store");
  });
});
