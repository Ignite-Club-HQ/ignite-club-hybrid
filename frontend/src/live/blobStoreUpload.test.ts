import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  begin_upload: vi.fn(), put_chunk: vi.fn(), finalize_upload: vi.fn(), abort_upload: vi.fn(), get_club_media_bytes: vi.fn(),
}));
vi.mock("./icpAgent", () => ({ createLiveActor: vi.fn(async () => ({ actor: mocks, canisterId: { toText: () => "store" } })) }));
vi.mock("./mediaStorage", () => ({
  MEDIA_BLOB_STORE_KEY: "media_blob_store", listBlobStoreKeys: () => ["media_blob_store"],
  orderBlobStoresForPath: () => ["media_blob_store"], blobAssetUrl: (_id: string, path: string) => `https://store/${path}`,
}));
import { uploadBytesToBlobStore } from "./blobStoreUpload";
import { sha256Hex } from "./blobStoreProtocol";
import type { IcpTargetConfig } from "./targetRegistry";
import type { Identity } from "@icp-sdk/core/agent";
const target = { canisterIds: { media_blob_store: "store" } } as unknown as IcpTargetConfig;
const identity = {} as Identity;
const bytes = new Uint8Array([1, 2, 3]);
const path = "clubs/c/photo.jpg";
describe("recoverable shared-quota uploads", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.begin_upload.mockResolvedValue({ Ok: "upload-1" });
    mocks.put_chunk.mockResolvedValue({ Ok: null });
    mocks.abort_upload.mockResolvedValue({ Ok: null });
    mocks.finalize_upload.mockResolvedValue({ Ok: { path, content_hash: await sha256Hex(bytes), content_length: 3n } });
  });
  it("retries a lost begin acknowledgement with identical terms on the same store", async () => {
    mocks.begin_upload.mockRejectedValueOnce(new Error("lost response"));
    const result = await uploadBytesToBlobStore(target, identity, path, bytes, "image/jpeg");
    expect(result.blobRef.path).toBe(path);
    expect(mocks.begin_upload).toHaveBeenCalledTimes(2);
    expect(mocks.begin_upload.mock.calls[0]).toEqual(mocks.begin_upload.mock.calls[1]);
  });
  it("retries the exact finalization after a lost commit response without aborting", async () => {
    mocks.finalize_upload.mockRejectedValueOnce(new Error("quota commit outcome unknown"));
    const result = await uploadBytesToBlobStore(target, identity, path, bytes, "image/jpeg");
    expect(result.blobRef.content_hash).toBe(await sha256Hex(bytes));
    expect(mocks.finalize_upload.mock.calls).toEqual([["upload-1"], ["upload-1"]]);
    expect(mocks.abort_upload).not.toHaveBeenCalled();
  });
  it("never releases an upload whose finalization outcome remains unknown", async () => {
    mocks.finalize_upload.mockRejectedValue(new Error("unknown outcome"));
    await expect(uploadBytesToBlobStore(target, identity, path, bytes, "image/jpeg")).rejects.toThrow("unknown outcome");
    expect(mocks.abort_upload).not.toHaveBeenCalled();
  });
  it("aborts chunk failures before any finalization starts", async () => {
    mocks.put_chunk.mockRejectedValue(new Error("chunk failed"));
    await expect(uploadBytesToBlobStore(target, identity, path, bytes, "image/jpeg")).rejects.toThrow("chunk failed");
    expect(mocks.abort_upload).toHaveBeenCalledWith("upload-1");
    expect(mocks.finalize_upload).not.toHaveBeenCalled();
  });
});
describe("Pro media allowance", () => {
  it("maps a full club media allowance to a friendly message", async () => {
    const { freeLimitMessage } = await import("./blobStoreUpload");
    expect(freeLimitMessage(new Error("Begin blob upload: StorageAllowanceFull"))).toMatch(/used all of its storage/);
    expect(freeLimitMessage(new Error("StorageAllowanceUnavailable"))).toMatch(/couldn't check/);
  });
  it("sums finalized and pending club media bytes from the store", async () => {
    const { getLiveClubMediaBytes } = await import("./blobStoreUpload");
    mocks.get_club_media_bytes.mockResolvedValue({ finalized: 10n, pending: 2n });
    await expect(getLiveClubMediaBytes(target, identity, "club-a")).resolves.toEqual({ finalized: 10, pending: 2 });
    expect(mocks.get_club_media_bytes).toHaveBeenCalledWith("club-a");
  });
});
