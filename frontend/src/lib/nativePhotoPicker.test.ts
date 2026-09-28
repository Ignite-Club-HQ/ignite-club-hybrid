import { beforeEach, describe, expect, it, vi } from "vitest";

const { platform, checkPermissions, requestPermissions, getPhoto, cameraPhotoToBlob, hasCameraPhotoSource, isCancelledSelectionError } = vi.hoisted(() => ({
  platform: { native: true, name: "ios" }, checkPermissions: vi.fn(), requestPermissions: vi.fn(), getPhoto: vi.fn(),
  cameraPhotoToBlob: vi.fn(), hasCameraPhotoSource: vi.fn(), isCancelledSelectionError: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => platform.native, getPlatform: () => platform.name } }));
vi.mock("@capacitor/camera", () => ({
  Camera: { checkPermissions, requestPermissions, getPhoto },
  CameraResultType: { Base64: "base64" }, CameraSource: { Photos: "PHOTOS" },
}));
vi.mock("@/lib/binaryUtils", () => ({
  cameraPhotoToBlob, hasCameraPhotoSource, describeCameraPhotoSource: vi.fn(() => "synthetic source"),
}));
vi.mock("@/lib/uploadErrorUtils", () => ({
  getReadableUploadError: (error: any) => error?.message || null,
  isCancelledSelectionError,
}));

import {
  PhotoPermissionDeniedError,
  ensurePhotoLibraryPermission,
  isPhotoPermissionError,
  pickNativePhoto,
  shouldUseNativePicker,
} from "./nativePhotoPicker";

describe("nativePhotoPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks(); platform.native = true; platform.name = "ios";
    checkPermissions.mockResolvedValue({ photos: "granted" });
    requestPermissions.mockResolvedValue({ photos: "granted" });
    const photo = { base64String: "abc", format: "jpeg" };
    getPhoto.mockResolvedValue(photo); hasCameraPhotoSource.mockReturnValue(true);
    cameraPhotoToBlob.mockResolvedValue({ blob: new Blob(["image"], { type: "image/jpeg" }), mimeType: "image/jpeg", extension: "jpg", previewUrl: "blob:test" });
    isCancelledSelectionError.mockReturnValue(false);
  });

  it("does nothing on web without querying native permissions", async () => {
    platform.native = false;
    await ensurePhotoLibraryPermission();
    expect(checkPermissions).not.toHaveBeenCalled(); expect(requestPermissions).not.toHaveBeenCalled();
    expect(shouldUseNativePicker()).toBe(false);
  });

  it.each(["granted", "limited"])("accepts %s photo-library access without prompting", async (photos) => {
    checkPermissions.mockResolvedValue({ photos });
    await expect(ensurePhotoLibraryPermission()).resolves.toBeUndefined();
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it("throws a typed error for explicitly denied access", async () => {
    checkPermissions.mockResolvedValue({ photos: "denied" });
    await expect(ensurePhotoLibraryPermission()).rejects.toBeInstanceOf(PhotoPermissionDeniedError);
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it("requests prompt-state permission and accepts limited access", async () => {
    checkPermissions.mockResolvedValue({ photos: "prompt" });
    requestPermissions.mockResolvedValue({ photos: "limited" });
    await ensurePhotoLibraryPermission();
    expect(requestPermissions).toHaveBeenCalledWith({ permissions: ["photos"] });
  });

  it("throws when requested permission remains denied", async () => {
    checkPermissions.mockResolvedValue({ photos: "prompt" });
    requestPermissions.mockResolvedValue({ photos: "denied" });
    await expect(ensurePhotoLibraryPermission()).rejects.toBeInstanceOf(PhotoPermissionDeniedError);
  });

  it.each(["ios", "android"])("uses the native picker on %s", (name) => {
    platform.name = name;
    expect(shouldUseNativePicker()).toBe(true);
  });

  it("passes bounded options to the photo picker and converts the returned source", async () => {
    const result = await pickNativePhoto({ quality: 75, width: 1200, height: 800 });
    expect(getPhoto).toHaveBeenCalledWith({
      source: "PHOTOS", quality: 75, width: 1200, height: 800, correctOrientation: true,
      presentationStyle: "fullscreen", resultType: "base64",
    });
    expect(cameraPhotoToBlob).toHaveBeenCalledWith(expect.objectContaining({ base64String: "abc" }));
    expect(result).toMatchObject({ mimeType: "image/jpeg", extension: "jpg" });
  });

  it("maps picker permission failures to the typed permission error", async () => {
    getPhoto.mockRejectedValue(new Error("Photo library permission denied"));
    await expect(pickNativePhoto()).rejects.toBeInstanceOf(PhotoPermissionDeniedError);
  });

  it("maps user cancellation without misreporting a permission failure", async () => {
    getPhoto.mockRejectedValue(new Error("cancelled")); isCancelledSelectionError.mockReturnValue(true);
    await expect(pickNativePhoto()).rejects.toThrow("Picker was cancelled");
  });

  it("recognizes typed and platform-specific permission errors", () => {
    expect(isPhotoPermissionError(new PhotoPermissionDeniedError())).toBe(true);
    expect(isPhotoPermissionError(new Error("NSPhotoLibrary access not authorized"))).toBe(true);
    expect(isPhotoPermissionError(new Error("ordinary image decode failure"))).toBe(false);
  });
});
