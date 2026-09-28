import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { cameraPhotoToBlob, hasCameraPhotoSource, describeCameraPhotoSource } from "@/lib/binaryUtils";
import { getReadableUploadError, isCancelledSelectionError } from "@/lib/uploadErrorUtils";

export interface NativePhotoResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  previewUrl: string;
}

export class PhotoPermissionDeniedError extends Error {
  constructor(message = "Photo library access is not granted") {
    super(message);
    this.name = "PhotoPermissionDeniedError";
  }
}

const isNativeIOS = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return getReadableUploadError(error) || "unknown error";
};

export async function ensureCameraPermissions(): Promise<void> {
  if (!isNativeIOS()) return;
  return;
}

/**
 * Checks current photo-library permission and requests it if not yet granted.
 * Throws PhotoPermissionDeniedError if the user has explicitly denied access.
 */
export async function ensurePhotoLibraryPermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const current = await Camera.checkPermissions();
    const photoStatus = current.photos;

    if (photoStatus === "granted" || photoStatus === "limited") return;

    if (photoStatus === "denied") {
      throw new PhotoPermissionDeniedError();
    }

    // 'prompt' or 'prompt-with-rationale' — request now
    const requested = await Camera.requestPermissions({ permissions: ["photos"] });
    if (requested.photos !== "granted" && requested.photos !== "limited") {
      throw new PhotoPermissionDeniedError();
    }
  } catch (error) {
    if (error instanceof PhotoPermissionDeniedError) throw error;
    // If the platform doesn't support checkPermissions, fall through and let the picker handle it
    console.warn("[nativePhotoPicker] Permission check failed:", error);
  }
}

export function resetPermissionCache(): void {
  return;
}

export interface NativePhotoPickOptions {
  quality?: number;
  width?: number;
  height?: number;
}

const buildBaseOptions = (options?: NativePhotoPickOptions) => ({
  source: CameraSource.Photos,
  quality: options?.quality ?? 90,
  correctOrientation: true,
  presentationStyle: "fullscreen" as const,
  ...(typeof options?.width === "number" ? { width: options.width } : {}),
  ...(typeof options?.height === "number" ? { height: options.height } : {}),
});

const isIOSPhotoLoadFailure = (error: unknown) => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("error loading image") ||
    message.includes("loading image") ||
    message.includes("selected photo data is unavailable")
  );
};

export const isPhotoPermissionError = (error: unknown): boolean => {
  if (error instanceof PhotoPermissionDeniedError) return true;
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("permission") ||
    message.includes("not authorized") ||
    message.includes("unauthorized") ||
    message.includes("denied access") ||
    message.includes("photo library") ||
    message.includes("nsphotolibrary") ||
    message.includes("read_external_storage") ||
    message.includes("media images")
  );
};

const getNativePhotoLoadError = (error: unknown) => {
  if (isIOSPhotoLoadFailure(error)) {
    return "That photo isn't fully available on this iPhone yet. Open it once in Photos or choose another image and try again.";
  }

  return getReadableUploadError(error) || "Could not load the selected photo. Please try again.";
};

/**
 * Picks a photo using the Capacitor Camera plugin on iOS.
 *
 * IMPORTANT iOS GESTURE RULE:
 * Camera.getPhoto MUST be invoked synchronously from the user's tap. Any
 * `await` before it (even on a no-op promise) yields a microtask which
 * iOS WKWebView treats as outside the gesture, causing the photo picker
 * to silently fail to open. We therefore call `Camera.getPhoto(...)`
 * immediately and only `await` the returned promise.
 */
export async function pickNativePhoto(options?: NativePhotoPickOptions): Promise<NativePhotoResult> {
  const baseOptions = buildBaseOptions(options);

  // Synchronously kick off the picker — preserves the user-gesture chain on iOS.
  const photoPromise = Camera.getPhoto({
    ...baseOptions,
    resultType: CameraResultType.Base64,
  });

  try {
    console.log("[nativePhotoPicker] Trying Camera plugin with Base64 result type");
    const photo = await photoPromise;

    if (!hasCameraPhotoSource(photo)) {
      console.warn("[nativePhotoPicker] Base64 photo has no source:", describeCameraPhotoSource(photo));
      throw new Error("No photo data returned from Camera plugin (Base64)");
    }

    const result = await cameraPhotoToBlob(photo);
    console.log("[nativePhotoPicker] Base64 strategy → blob OK, size:", result.blob.size, "mime:", result.mimeType);
    return result;
  } catch (error: unknown) {
    if (isPhotoPermissionError(error)) {
      throw new PhotoPermissionDeniedError(getErrorMessage(error));
    }
    if (isCancelledSelectionError(error)) {
      throw new Error("Picker was cancelled");
    }
    console.error("[nativePhotoPicker] Base64 strategy failed:", getErrorMessage(error));
    await wait(50);
    throw new Error(getNativePhotoLoadError(error));
  }
}

/** Check if current platform should use native photo picker.
 * Per project rule: native (iOS + Android) must use the Capacitor Camera
 * plugin (Base64) — never the generic HTML <input type="file"> picker, which
 * fails intermittently in the Android WebView (content:// URIs, blob: reads,
 * and large image reads all break the standard browser flow). */
export const shouldUseNativePicker = () =>
  Capacitor.isNativePlatform() && (Capacitor.getPlatform() === "ios" || Capacitor.getPlatform() === "android");
