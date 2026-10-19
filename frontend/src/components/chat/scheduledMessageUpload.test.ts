import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/features/vault/clubMediaAllowance", () => ({ uploadWithinClubMediaAllowance: (_club: unknown, _bytes: unknown, upload: () => Promise<unknown>) => upload() }));

const { upload, getPublicUrl, compressImage, measureImageDimensions, appendDimensionsToUrl, setCachedImageAspectRatio } = vi.hoisted(() => ({
  upload: vi.fn(), getPublicUrl: vi.fn(), compressImage: vi.fn(),
  measureImageDimensions: vi.fn(), appendDimensionsToUrl: vi.fn(), setCachedImageAspectRatio: vi.fn(),
}));
const icpMode = vi.hoisted(() => process.env.IGNITE_TEST_BACKEND_MODE === "icp");
const mockSupabase = await vi.hoisted(async () => {
  const { createMockSupabaseClient: createClient } = await import("@/test/mockSupabaseClient");
  return createClient();
});
const mocks = vi.hoisted(() => ({ isIcp: false, blobUpload: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mockSupabase }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => mocks.isIcp }));
vi.mock("@/live/mediaUpload", () => ({ tryUploadMediaToBlobStore: mocks.blobUpload }));
vi.mock("@/lib/imageCompression", () => ({ compressImage }));
vi.mock("@/lib/binaryUtils", () => ({ mimeToExtension: (mime: string) => mime === "image/png" ? "png" : "jpg" }));
vi.mock("@/lib/chatImageAspectCache", () => ({ measureImageDimensions, appendDimensionsToUrl, setCachedImageAspectRatio }));

import { uploadScheduledImage } from "./scheduledMessageUpload";

function imageFile(name = "photo.jpg", type = "image/jpeg", bytes = 5) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("uploadScheduledImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isIcp = icpMode;
    mocks.blobUpload.mockResolvedValue({ url: "https://files.icp0.io/scheduled.jpg", blobRef: { canister: "blob-store", path: "p", content_hash: "h" } });
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    upload.mockResolvedValue({ error: null });
    getPublicUrl.mockReturnValue({ data: { publicUrl: "https://example.invalid/upload.jpg" } });
    mockSupabase.storage.from.mockReturnValue({ upload, getPublicUrl });
    compressImage.mockImplementation(async (file: File) => ({ file }));
    measureImageDimensions.mockResolvedValue(null);
    appendDimensionsToUrl.mockImplementation((url: string, w: number, h: number) => `${url}?w=${w}&h=${h}`);
    vi.spyOn(Date, "now").mockReturnValue(1234567890);
  });

  it("rejects non-images before authentication or storage access", async () => {
    await expect(uploadScheduledImage(imageFile("notes.txt", "text/plain"))).rejects.toThrow("Please select an image file");
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled(); expect(mockSupabase.storage.from).not.toHaveBeenCalled();
  });

  it.runIf(!icpMode)("accepts exactly 10MB but rejects one byte over the limit", async () => {
    const exact = imageFile("exact.jpg", "image/jpeg", 10 * 1024 * 1024);
    await expect(uploadScheduledImage(exact)).resolves.toBe("https://example.invalid/upload.jpg");
    vi.clearAllMocks();
    mocks.isIcp = false;
    const over = imageFile("over.jpg", "image/jpeg", 10 * 1024 * 1024 + 1);
    await expect(uploadScheduledImage(over)).rejects.toThrow("Image must be less than 10MB");
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
  });

  it.runIf(!icpMode)("rejects unauthenticated uploads before compression or storage", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(uploadScheduledImage(imageFile())).rejects.toThrow("Not authenticated");
    expect(compressImage).toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  it.runIf(!icpMode).each([
    [{ clubId: "club-1", teamId: "team-1" }, "clubs/club-1/teams/team-1/user-1/scheduled-1234567890.jpg"],
    [{ clubId: "club-1" }, "clubs/club-1/user-1/scheduled-1234567890.jpg"],
    [{}, "general/user-1/scheduled-1234567890.jpg"],
  ])("uses the correct scoped storage path", async (target, expectedPath) => {
    await uploadScheduledImage(imageFile(), target);
    expect(mockSupabase.storage.from).toHaveBeenCalledWith("chat-attachments");
    expect(upload).toHaveBeenCalledWith(expectedPath, expect.any(File), {
      contentType: "image/jpeg", upsert: false, cacheControl: "31536000",
    });
    expect(getPublicUrl).toHaveBeenCalledWith(expectedPath);
  });

  it.runIf(!icpMode)("uses the original file when compression fails", async () => {
    const original = imageFile();
    compressImage.mockRejectedValue(new Error("compression unavailable"));
    await uploadScheduledImage(original, { clubId: "club-1", teamId: "team-1" });
    expect(upload.mock.calls[0][1]).toBe(original);
  });

  it.runIf(!icpMode)("surfaces storage errors and does not request a public URL", async () => {
    upload.mockResolvedValue({ error: { message: "RLS denied" } });
    await expect(uploadScheduledImage(imageFile(), { clubId: "club-1" })).rejects.toThrow("RLS denied");
    expect(getPublicUrl).not.toHaveBeenCalled();
  });

  it.runIf(!icpMode)("adds measured dimensions and caches the resulting aspect ratio", async () => {
    measureImageDimensions.mockResolvedValue({ width: 1600, height: 900 });
    const result = await uploadScheduledImage(imageFile());
    expect(result).toBe("https://example.invalid/upload.jpg?w=1600&h=900");
    expect(setCachedImageAspectRatio).toHaveBeenCalledWith([result], 1600 / 900);
  });

  describe.runIf(icpMode)("Internet Identity / ICP messaging routing", () => {
    it("uploads encrypted bytes to the blob store instead of Supabase Storage", async () => {
      const result = await uploadScheduledImage(imageFile(), { clubId: "club-1", teamId: "team-1" });
      expect(result).toBe("https://files.icp0.io/scheduled.jpg");
      expect(mockSupabase.storage.from).not.toHaveBeenCalled();
      expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
      const [args] = mocks.blobUpload.mock.calls[0];
      expect(args.storagePath).toMatch(/^clubs\/club-1\/teams\/team-1\/scheduled\/\d+-[a-z0-9]+\.jpg$/);
      expect(args.mime).toBe("image/jpeg");
    });

    it("scopes the blob-store path to club-only and clubless targets", async () => {
      await uploadScheduledImage(imageFile(), { clubId: "club-1" });
      expect(mocks.blobUpload.mock.calls[0][0].storagePath).toMatch(/^clubs\/club-1\/scheduled\/\d+-[a-z0-9]+\.jpg$/);
      mocks.blobUpload.mockClear();
      await uploadScheduledImage(imageFile());
      expect(mocks.blobUpload.mock.calls[0][0].storagePath).toMatch(/^general\/scheduled\/\d+-[a-z0-9]+\.jpg$/);
    });

    it("throws instead of silently falling back to Supabase when the blob store is unavailable", async () => {
      mocks.blobUpload.mockResolvedValue(null);
      await expect(uploadScheduledImage(imageFile())).rejects.toThrow(
        "Media uploads are not available yet for Internet Identity accounts",
      );
      expect(mockSupabase.storage.from).not.toHaveBeenCalled();
    });

    it("still measures and encodes dimensions for ICP uploads", async () => {
      measureImageDimensions.mockResolvedValue({ width: 800, height: 400 });
      const result = await uploadScheduledImage(imageFile());
      expect(result).toBe("https://files.icp0.io/scheduled.jpg?w=800&h=400");
    });
  });
});
