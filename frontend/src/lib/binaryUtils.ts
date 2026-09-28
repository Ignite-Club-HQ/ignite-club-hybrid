import { Capacitor } from "@capacitor/core";

/**
 * Base64-to-Blob conversion.
 * Uses fetch(data:URI) which is handled natively by the browser/WebView,
 * avoiding the memory pressure that atob() + manual Uint8Array creation
 * causes on iOS WebView for large photos (HEIC, 10 MB+).
 * Falls back to chunked atob() approach if fetch fails.
 */

const SLICE_SIZE = 8192; // 8 KB per chunk – used by fallback

function base64ToBlobFallback(base64String: string, mimeType: string): Blob {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);

  for (let offset = 0; offset < len; offset += SLICE_SIZE) {
    const end = Math.min(offset + SLICE_SIZE, len);
    for (let i = offset; i < end; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
  }

  return new Blob([bytes], { type: mimeType });
}

export async function base64ToBlobAsync(base64String: string, mimeType: string): Promise<Blob> {
  try {
    // fetch(data:URI) lets the browser handle the conversion natively,
    // which is significantly more memory-efficient on iOS WebView.
    const dataUrl = `data:${mimeType};base64,${base64String}`;
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    if (blob.size === 0) {
      throw new Error("fetch(data:URI) returned empty blob");
    }
    return blob;
  } catch (fetchError) {
    console.warn("[base64ToBlobAsync] fetch(data:URI) failed, using fallback:", fetchError);
    return base64ToBlobFallback(base64String, mimeType);
  }
}

/** @deprecated Use base64ToBlobAsync instead – kept for non-async call sites */
export function base64ToBlob(base64String: string, mimeType: string): Blob {
  return base64ToBlobFallback(base64String, mimeType);
}

/** Common native photo format → MIME mapping */
export const PHOTO_FORMAT_TO_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** MIME → file extension (defaults to jpg) */
export function mimeToExtension(mimeType: string): string {
  const t = mimeType.toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("gif")) return "gif";
  if (t.includes("webp")) return "webp";
  if (t.includes("heic")) return "heic";
  if (t.includes("heif")) return "heif";
  return "jpg";
}

const normalizeBase64String = (base64String: string): string => {
  const withoutDataUrlPrefix = base64String.includes(",")
    ? base64String.split(",")[1]
    : base64String;

  const normalized = withoutDataUrlPrefix
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const paddingNeeded = normalized.length % 4;
  if (paddingNeeded === 0) return normalized;

  return normalized.padEnd(normalized.length + (4 - paddingNeeded), "=");
};

export interface CameraPhotoLike {
  base64String?: string | null;
  webPath?: string;
  path?: string;
  format?: string | null;
}

const NATIVE_READ_RETRY_ATTEMPTS = 3;
const NATIVE_READ_RETRY_DELAY_MS = 400;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
};

const getPhotoSourceCandidates = (photo: CameraPhotoLike): string[] => {
  const candidates = [
    photo.webPath,
    photo.path ? Capacitor.convertFileSrc(photo.path) : undefined,
    photo.path,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return [...new Set(candidates)];
};

const readBlobFromResponse = async (
  response: Response,
  fallbackMimeType: string,
): Promise<{ blob: Blob; mimeType: string }> => {
  const fetchedBlob = await response.blob();
  const mimeType = fetchedBlob.type || fallbackMimeType;

  if (fetchedBlob.type) {
    return { blob: fetchedBlob, mimeType };
  }

  return {
    blob: new Blob([await fetchedBlob.arrayBuffer()], { type: mimeType }),
    mimeType,
  };
};

const fetchPhotoBlobFromSource = async (
  sourcePath: string,
  fallbackMimeType: string,
): Promise<{ blob: Blob; mimeType: string }> => {
  let lastError: unknown;

  // On native iOS, give iCloud more time to finalize the temp file.
  // Optimized photos can take 1-2s to download from iCloud.
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
    await wait(600);
  }

  for (let attempt = 0; attempt <= NATIVE_READ_RETRY_ATTEMPTS; attempt += 1) {
    try {
      console.log(`[cameraPhotoToBlob] fetch attempt ${attempt + 1}/${NATIVE_READ_RETRY_ATTEMPTS + 1} for: ${sourcePath.substring(0, 120)}`);
      const response = await fetch(sourcePath, { cache: "no-store" });
      console.log(`[cameraPhotoToBlob] fetch response: ${response.status} ${response.statusText}`);
      if (!response.ok) {
        throw new Error(`Failed to read selected photo (HTTP ${response.status} ${response.statusText})`);
      }

      const result = await readBlobFromResponse(response, fallbackMimeType);
      
      // Validate that the blob actually has content
      if (result.blob.size === 0) {
        throw new Error("Photo data is empty (0 bytes)");
      }
      
      console.log(`[cameraPhotoToBlob] blob OK: size=${result.blob.size} type=${result.mimeType}`);
      return result;
    } catch (error) {
      console.warn(`[cameraPhotoToBlob] fetch attempt ${attempt + 1} failed:`, getErrorMessage(error));
      lastError = error;
      if (attempt < NATIVE_READ_RETRY_ATTEMPTS) {
        const delay = NATIVE_READ_RETRY_DELAY_MS * (attempt + 1);
        console.log(`[cameraPhotoToBlob] retrying in ${delay}ms...`);
        await wait(delay);
        continue;
      }
    }
  }

  throw new Error(getErrorMessage(lastError));
};

export function hasCameraPhotoSource(photo: CameraPhotoLike): boolean {
  return Boolean(photo.base64String || photo.webPath || photo.path);
}

export function describeCameraPhotoSource(photo: CameraPhotoLike): string {
  return `base64=${Boolean(photo.base64String)} webPath=${Boolean(photo.webPath)} path=${Boolean(photo.path)}`;
}

export async function cameraPhotoToBlob(photo: CameraPhotoLike): Promise<{
  blob: Blob;
  mimeType: string;
  extension: string;
  previewUrl: string;
}> {
  console.log("[cameraPhotoToBlob] START", {
    hasBase64: !!photo.base64String,
    base64Length: photo.base64String?.length ?? 0,
    webPath: photo.webPath ?? "(none)",
    path: photo.path ?? "(none)",
    format: photo.format ?? "(none)",
  });

  const normalizedFormat = (photo.format || "jpeg").toLowerCase();
  const fallbackMimeType = PHOTO_FORMAT_TO_MIME[normalizedFormat] || "image/jpeg";
  let lastError: unknown;

  if (photo.base64String) {
    try {
      console.log("[cameraPhotoToBlob] trying base64 path, length:", photo.base64String.length);
      const normalizedBase64 = normalizeBase64String(photo.base64String);
      const blob = await base64ToBlobAsync(normalizedBase64, fallbackMimeType);
      console.log("[cameraPhotoToBlob] base64 → blob OK, size:", blob.size);

      return {
        blob,
        mimeType: fallbackMimeType,
        extension: mimeToExtension(fallbackMimeType),
        previewUrl: URL.createObjectURL(blob),
      };
    } catch (error) {
      console.error("[cameraPhotoToBlob] base64 conversion FAILED:", getErrorMessage(error));
      lastError = error;
    }
  }

  const sourceCandidates = getPhotoSourceCandidates(photo);
  console.log("[cameraPhotoToBlob] URI candidates:", sourceCandidates.length, sourceCandidates.map(s => s.substring(0, 80)));

  for (const sourcePath of sourceCandidates) {
    try {
      const { blob, mimeType } = await fetchPhotoBlobFromSource(sourcePath, fallbackMimeType);

      return {
        blob,
        mimeType,
        extension: mimeToExtension(mimeType),
        previewUrl: sourcePath,
      };
    } catch (error) {
      console.warn("[cameraPhotoToBlob] candidate failed:", sourcePath.substring(0, 80), getErrorMessage(error));
      lastError = error;
    }
  }

  const finalMsg = lastError
    ? `Selected photo data is unavailable (${getErrorMessage(lastError)})`
    : "Selected photo data is unavailable (no base64, webPath, or path)";
  console.error("[cameraPhotoToBlob] ALL paths exhausted:", finalMsg);
  throw new Error(finalMsg);
}


