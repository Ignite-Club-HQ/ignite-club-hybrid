import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  icp: true,
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: any) =>
    mocks.icp ? providers.icp({ identity: "session", target: "icp" }) : providers.supabase(),
}));
vi.mock("@/live/mediaUpload", () => ({ tryUploadMediaToBlobStore: mocks.upload }));
vi.mock("@/live/features/club", () => ({
  getLiveClubProfile: mocks.getProfile,
  saveLiveClubProfile: mocks.saveProfile,
}));

import { saveIcpMonogramLogo } from "./monogramLogoIcpUpload";

const blob = { size: 10 } as Blob;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.icp = true;
  mocks.upload.mockResolvedValue({ url: "https://files.icp0.io/logo.png", blobRef: { path: "x" } });
  mocks.getProfile.mockResolvedValue([{ id: "giddy-goat", name: "Giddy Goat" }]);
  mocks.saveProfile.mockResolvedValue({});
});

describe("ICP monogram logo save", () => {
  it("uploads the PNG to the blob store under clubs/<clubId>/logos/ and saves the club profile", async () => {
    const url = await saveIcpMonogramLogo("giddy-goat", blob);
    expect(url).toBe("https://files.icp0.io/logo.png");

    const [upload] = mocks.upload.mock.calls[0];
    expect(upload.file).toBe(blob);
    expect(upload.mime).toBe("image/png");
    expect(upload.storagePath).toMatch(/^clubs\/giddy-goat\/logos\/[a-f0-9-]+\.png$/);

    expect(mocks.getProfile).toHaveBeenCalledWith({ identity: "session", target: "icp" }, "giddy-goat");
    expect(mocks.saveProfile).toHaveBeenCalledWith(
      { identity: "session", target: "icp" },
      expect.objectContaining({ id: "giddy-goat", name: "Giddy Goat", logo_url: "https://files.icp0.io/logo.png" }),
    );
  });

  it("builds a fresh profile when the club has none yet", async () => {
    mocks.getProfile.mockResolvedValue([]);
    await saveIcpMonogramLogo("new-club", blob);
    expect(mocks.saveProfile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "new-club", logo_url: "https://files.icp0.io/logo.png" }),
    );
  });

  it("throws when the blob store upload is unavailable", async () => {
    mocks.upload.mockResolvedValue(null);
    await expect(saveIcpMonogramLogo("giddy-goat", blob)).rejects.toThrow("ICP storage");
    expect(mocks.saveProfile).not.toHaveBeenCalled();
  });

  it("does not divert an ICP save to Supabase when routing is unavailable", async () => {
    mocks.icp = false;
    await expect(saveIcpMonogramLogo("giddy-goat", blob)).rejects.toThrow("connect to ICP");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("requires a club id", async () => {
    await expect(saveIcpMonogramLogo("", blob)).rejects.toThrow("Choose a club");
  });
});
