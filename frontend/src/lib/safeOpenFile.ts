import { Capacitor } from "@capacitor/core";
import { safeOpenUrl } from "./safeOpenUrl";
import { loadOptionalNativeModule } from "./loadOptionalNativeModule";

/**
 * Recognized Supabase storage URL forms that require authorization before
 * download/open. Kept in sync with the classifier used by resolveSignedUrl.
 */
const PRIVATE_STORAGE_MARKERS = [
  "/storage/v1/object/public/",
  "/storage/v1/object/sign/",
  "/storage/v1/object/authenticated/",
  "/storage/v1/render/image/public/",
  "/storage/v1/render/image/sign/",
];

function isSupabaseStorageUrl(url: string): boolean {
  const clean = url.split("?")[0].split("#")[0];
  return PRIVATE_STORAGE_MARKERS.some((m) => clean.includes(m));
}

type LocalCopy = {
  /** file:// URI (or native path) of the cached copy. */
  uri: string;
  /** Content type reported by the server when we fetched the bytes ourselves. */
  serverContentType: string | null;
};

/**
 * Open a remote file (PDF, docx, etc.) in the most user-friendly way.
 *
 * Native pipeline (Android / iOS):
 *   1. Resolve an authorized signed URL for Supabase storage files (fail closed).
 *   2. Download to the app cache under the file's REAL name so the OS viewer
 *      shows "Club policy.pdf" rather than a storage host name. We try the
 *      native downloader first and fall back to fetch + write, because
 *      Filesystem.downloadFile is known to fail on some devices / signed URLs.
 *   3. Hand the local copy to the OS viewer (specific MIME, then generic).
 *   4. If no viewer can take it, offer the OS share sheet (still shows the
 *      real file name, lets the user pick Drive / Files / another app).
 *   5. Only as a last resort open the signed URL in the browser.
 *
 * Security: for recognized Supabase storage URLs we resolve to an authorized
 * signed URL BEFORE any download or browser operation. If signing fails we
 * fail closed — the raw private URL is never downloaded, opened, or passed to
 * the browser fallback, and no tokens or private URLs are included in errors.
 */
export async function safeOpenFile(
  url: string,
  opts: { fileName?: string; mimeType?: string } = {},
): Promise<void> {
  const isNative = Capacitor.isNativePlatform();
  const isStorageUrl = isSupabaseStorageUrl(url);

  // Resolve signed URL up-front for Supabase storage URLs. Fail closed on
  // signing errors so we never expose or download the raw private URL.
  let resolvedUrl = url;
  if (isStorageUrl) {
    try {
      const { resolveSignedUrl } = await import("@/hooks/useSignedPhotoUrl");
      resolvedUrl = await resolveSignedUrl(url);
    } catch {
      // Do not include the raw URL, tokens, or the underlying error message
      // (which may contain sensitive query params) in the thrown error.
      console.warn("[safeOpenFile] signing failed; refusing to open private file");
      throw new Error("This file could not be authorized for viewing. Please try again.");
    }
  }

  if (!isNative) {
    await safeOpenUrl(resolvedUrl);
    return;
  }

  // Build a safe filename in a unique cache sub-directory so the viewer
  // shows the real document name (not a timestamped/mangled one).
  const guessedName = opts.fileName?.trim() || guessFileNameFromUrl(resolvedUrl);
  const displayName = withExtension(sanitizeFileName(guessedName), resolvedUrl);
  const relativePath = `ignite-files/${Date.now()}/${displayName}`;

  let local: LocalCopy | null = null;
  try {
    local = await downloadToCache(resolvedUrl, relativePath, displayName);
  } catch (err) {
    console.warn("[safeOpenFile] could not cache file locally:", describeError(err));
  }

  if (!local) {
    // Nothing on disk to hand to a viewer — browser is the only option left.
    console.warn("[safeOpenFile] no local copy; falling back to browser");
    await safeOpenUrl(resolvedUrl);
    return;
  }

  const primaryType =
    normalizeMimeType(opts.mimeType) ||
    normalizeMimeType(local.serverContentType) ||
    guessMimeFromName(displayName);

  if (await openWithViewer(local.uri, primaryType)) return;

  // No viewer accepted the file. The share sheet still surfaces the real file
  // name and lets the user pick Files / Drive / another app — far better than
  // a browser tab showing the storage host name.
  if (await shareLocalFile(local.uri, displayName)) return;

  // Fall back to browser using the RESOLVED URL only — never the raw
  // private URL.
  console.warn("[safeOpenFile] viewer and share unavailable, falling back to browser");
  await safeOpenUrl(resolvedUrl);
}

/**
 * Download the remote file into the app cache. Tries the native downloader
 * first, then a fetch + write fallback (the same strategy downloadImage uses
 * because Filesystem.downloadFile is unreliable on some Android builds and
 * with some signed URLs). Throws only when every strategy fails.
 */
async function downloadToCache(
  url: string,
  relativePath: string,
  displayName: string,
): Promise<LocalCopy> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");

  // Strategy 1: native download straight to disk.
  try {
    const dl = (await Filesystem.downloadFile({
      url,
      path: relativePath,
      directory: Directory.Cache,
      recursive: true,
    })) as { path?: string; uri?: string };
    let uri = dl?.path || dl?.uri || null;
    if (!uri) {
      uri = (await Filesystem.getUri({ path: relativePath, directory: Directory.Cache })).uri;
    }
    if (uri) {
      // Confirm bytes actually landed — some builds resolve with a path but
      // write nothing (e.g. HTTP errors swallowed by the native downloader).
      let size = -1;
      try {
        size = (await Filesystem.stat({ path: relativePath, directory: Directory.Cache })).size ?? -1;
      } catch {
        size = -1; // stat unsupported here; trust the downloader
      }
      if (size !== 0) return { uri, serverContentType: null };
    }
    console.warn("[safeOpenFile] native download produced no readable file; trying fetch");
  } catch (err) {
    console.warn("[safeOpenFile] Filesystem.downloadFile failed, trying fetch:", describeError(err));
  }

  // Strategy 2: fetch the bytes in the WebView and write them ourselves.
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch file (${response.status})`);
  const blob = await response.blob();
  const serverContentType =
    (blob.type || response.headers.get("content-type") || "").split(";")[0].trim() || null;
  const base64 = await blobToBase64(blob);

  const writeAt = async (path: string) => {
    const written = await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    return written.uri || (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
  };

  try {
    const uri = await writeAt(relativePath);
    if (uri) return { uri, serverContentType };
  } catch (err) {
    console.warn("[safeOpenFile] nested cache write failed, trying flat path:", describeError(err));
  }

  // Strategy 3: flat cache path (some Filesystem builds mishandle nested
  // directories). Keep the real name at the end so the viewer still shows it.
  const uri = await writeAt(`ignite-${Date.now()}-${displayName}`);
  if (!uri) throw new Error("Cache write produced no local path");
  return { uri, serverContentType };
}

/** Try the OS viewer with the specific type, then generically. */
async function openWithViewer(localPath: string, primaryType: string): Promise<boolean> {
  let FileOpener: { open: (o: { filePath: string; contentType?: string; openWithDefault?: boolean }) => Promise<void> };
  try {
    ({ FileOpener } = await loadOptionalNativeModule("@capacitor-community/file-opener"));
  } catch (err) {
    console.warn("[safeOpenFile] FileOpener unavailable:", describeError(err));
    return false;
  }

  try {
    await FileOpener.open({ filePath: localPath, contentType: primaryType, openWithDefault: true });
    return true;
  } catch (openErr) {
    // Some devices reject a specific content type but happily open the file
    // when asked generically.
    console.warn("[safeOpenFile] viewer rejected content type, retrying generically:", describeError(openErr));
  }

  try {
    await FileOpener.open({
      filePath: localPath,
      contentType: "application/octet-stream",
      openWithDefault: true,
    });
    return true;
  } catch (err) {
    console.warn("[safeOpenFile] generic viewer open failed:", describeError(err));
    return false;
  }
}

/** Offer the OS share sheet for the cached copy (keeps the real file name). */
async function shareLocalFile(localPath: string, title: string): Promise<boolean> {
  try {
    const { Share } = await import("@capacitor/share");
    await Share.share({ title, files: [localPath] });
    return true;
  } catch (err) {
    // User dismissing the sheet also rejects — that's still "handled".
    if (isUserCancel(err)) return true;
    console.warn("[safeOpenFile] share fallback failed:", describeError(err));
    return false;
  }
}

function isUserCancel(err: unknown): boolean {
  const msg = describeError(err).toLowerCase();
  return msg.includes("cancel") || msg.includes("dismiss");
}

function describeError(err: unknown): string {
  if (!err) return "unknown";
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && "message" in (err as Record<string, unknown>)) {
    return String((err as Record<string, unknown>).message);
  }
  return String(err);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Accept only real MIME types ("type/subtype"). Vault records sometimes store
 * bare extensions ("pdf") in file_type, which native viewers reject.
 */
function normalizeMimeType(value?: string | null): string | null {
  const v = (value || "").trim().toLowerCase().split(";")[0].trim();
  if (!v || v === "application/octet-stream") return null;
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(v)) return null;
  return v;
}

function guessFileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "file";
    return decodeURIComponent(last);
  } catch {
    return "file";
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
}

function guessMimeFromName(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "csv":
      return "text/csv";
    case "txt":
      return "text/plain";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "mp3":
      return "audio/mpeg";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

/**
 * Ensure the local file keeps a sensible extension so the OS picks the right
 * viewer — falls back to the extension from the remote URL path.
 */
function withExtension(name: string, url: string): string {
  if (/\.[a-zA-Z0-9]{1,8}$/.test(name)) return name;
  const fromUrl = guessFileNameFromUrl(url);
  const m = fromUrl.match(/\.[a-zA-Z0-9]{1,8}$/);
  return m ? `${name}${m[0]}` : name;
}
