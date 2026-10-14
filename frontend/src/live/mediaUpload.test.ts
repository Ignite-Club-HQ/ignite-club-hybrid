import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveIcpTarget: vi.fn(() => ({ alias: "test-target" })),
  getCurrentInternetIdentity: vi.fn(),
  isBlobStoreConfigured: vi.fn(() => true),
  uploadBytesToBlobStore: vi.fn(),
  clubIdFromMediaPath: vi.fn((path: string) => path.startsWith("clubs/") ? path.split("/")[1] : null),
  encryptClubMedia: vi.fn(),
  encryptPiiValue: vi.fn(),
  isClubMediaLockSupported: vi.fn(() => true),
  grantLiveClubPiiRead: vi.fn(),
  grantLivePiiReadCompetition: vi.fn(),
  registerLivePii: vi.fn(),
  sha256Hex: vi.fn(() => "hash"),
}));

vi.mock("./internetIdentityAuth", () => ({
  getCurrentInternetIdentity: mocks.getCurrentInternetIdentity,
}));
vi.mock("./targetRegistry", () => ({
  getActiveIcpTarget: mocks.getActiveIcpTarget,
}));
vi.mock("./blobStoreUpload", () => ({
  isBlobStoreConfigured: mocks.isBlobStoreConfigured,
  uploadBytesToBlobStore: mocks.uploadBytesToBlobStore,
}));
vi.mock("./authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("./piiVetKeys", () => ({
  clubIdFromMediaPath: mocks.clubIdFromMediaPath,
  encryptClubMedia: mocks.encryptClubMedia,
  encryptPiiValue: mocks.encryptPiiValue,
  isClubMediaLockSupported: mocks.isClubMediaLockSupported,
}));
vi.mock("./features/vault", () => ({
  grantLiveClubPiiRead: mocks.grantLiveClubPiiRead,
  grantLivePiiReadCompetition: mocks.grantLivePiiReadCompetition,
  registerLivePii: mocks.registerLivePii,
}));
vi.mock("./mediaDecrypt", () => ({ MEDIA_BLOB_PII_FIELD: "blob" }));
vi.mock("./blobStoreProtocol", () => ({ sha256Hex: mocks.sha256Hex }));

import { tryUploadMediaToBlobStore } from "./mediaUpload";

describe("tryUploadMediaToBlobStore competition scope", () => {
  const identity = { getPrincipal: () => "uploader-principal" };
  const target = { alias: "test-target" };
  const blobRef = { canister: "aaaaa-aa", path: "/clubs/club-1/photo.jpg", content_hash: "hash" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveIcpTarget.mockReturnValue(target);
    mocks.getCurrentInternetIdentity.mockResolvedValue(identity);
    mocks.isBlobStoreConfigured.mockReturnValue(true);
    mocks.isClubMediaLockSupported.mockResolvedValue(true);
    mocks.encryptClubMedia.mockResolvedValue(new Uint8Array([1]));
    mocks.encryptPiiValue.mockResolvedValue(new Uint8Array([2]));
    mocks.registerLivePii.mockResolvedValue(undefined);
    mocks.grantLiveClubPiiRead.mockResolvedValue(undefined);
    mocks.grantLivePiiReadCompetition.mockResolvedValue(undefined);
    mocks.uploadBytesToBlobStore.mockResolvedValue({ url: "https://blob", blobRef });
    mocks.sha256Hex.mockResolvedValue("hash");
  });

  it("uses per-file encryption and a live competition grant for competition photos", async () => {
    await tryUploadMediaToBlobStore({
      storagePath: "clubs/club-1/photo.jpg",
      file: new Blob(["photo"], { type: "image/jpeg" }),
      mime: "image/jpeg",
      competitionId: "competition-1",
    });

    expect(mocks.encryptPiiValue).toHaveBeenCalledOnce();
    expect(mocks.encryptClubMedia).not.toHaveBeenCalled();
    expect(mocks.registerLivePii).toHaveBeenCalledOnce();
    expect(mocks.grantLivePiiReadCompetition).toHaveBeenCalledWith(
      { target, identity },
      "clubs/club-1/photo.jpg",
      "blob",
      "competition-1",
    );
    expect(mocks.grantLiveClubPiiRead).not.toHaveBeenCalled();
  });

  it("keeps ordinary club photos on the shared club-media key", async () => {
    await tryUploadMediaToBlobStore({
      storagePath: "clubs/club-1/photo.jpg",
      file: new Blob(["photo"], { type: "image/jpeg" }),
      mime: "image/jpeg",
    });

    expect(mocks.encryptClubMedia).toHaveBeenCalledWith(
      { target, identity },
      "club-1",
      expect.any(Uint8Array),
    );
    expect(mocks.encryptPiiValue).not.toHaveBeenCalled();
    expect(mocks.grantLivePiiReadCompetition).not.toHaveBeenCalled();
  });
});