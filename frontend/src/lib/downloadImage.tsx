import { Capacitor, registerPlugin } from "@capacitor/core";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { toast } from "sonner";
import { resolveSignedUrl } from "@/hooks/useSignedPhotoUrl";
import type { DownloadFileResult } from "@capacitor/filesystem";
import { DownloadSuccessToast } from "@/components/DownloadSuccessToast";

const loadOptionalNativeModule = (specifier: string) =>
  new Function("moduleName", "return import(moduleName)")(specifier) as Promise<any>;

type DownloadResultWithLegacyUri = DownloadFileResult & { uri?: string };

interface IgnitePhotoSaverPlugin {
  savePhoto(options: { url?: string; dataUrl?: string; base64?: string }): Promise<{ identifier?: string }>;
}

const IgnitePhotoSaver = registerPlugin<IgnitePhotoSaverPlugin>("IgnitePhotoSaver");

/**
 * Download an image without exposing the backend URL or storage filename
 * to the user. Fetches the image as a blob and saves it under a friendly
 * filename (e.g. "ignite-photo-2026-04-22.jpg").
 *
 * On Android native: saves directly to the user's photo library via MediaStore.
 * This must not use the Share plugin; the download action should not open the
 * Android share sheet.
 *
 * UX: shows a loading toast while the download is in progress, then a
 * success toast (with an "Open" action where applicable) or an error toast.
 */
// Track in-flight downloads so repeated taps don't kick off duplicate work
// (and so a second tap doesn't create a duplicate file in the photo library).
const inflightDownloads = new Set<string>();

export function isDownloadInFlight(url: string): boolean {
  return inflightDownloads.has(url);
}

export async function downloadImage(url: string, friendlyBaseName = "ignite-photo"): Promise<void> {
  if (inflightDownloads.has(url)) {
    toast.info("Already downloading…");
    return;
  }
  inflightDownloads.add(url);
  const toastId = toast.loading("Downloading photo…");
  try {
    await downloadImageInner(url, friendlyBaseName, toastId);
  } catch (err) {
    console.warn("[downloadImage] failed:", err);
    toast.error("Download failed", { id: toastId, description: "Please try again" });
  } finally {
    inflightDownloads.delete(url);
  }
}

export async function downloadVideo(url: string, friendlyBaseName = "ignite-video"): Promise<void> {
  if (inflightDownloads.has(url)) {
    toast.info("Already downloading…");
    return;
  }
  inflightDownloads.add(url);
  const toastId = toast.loading("Downloading video…");
  try {
    await downloadVideoInner(url, friendlyBaseName, toastId);
  } catch (err) {
    console.warn("[downloadVideo] failed:", err);
    toast.error("Download failed", { id: toastId, description: "Please try again" });
  } finally {
    inflightDownloads.delete(url);
  }
}

/** Unified entry point. Routes to image/video pipeline based on `kind`. */
export async function downloadMedia(
  url: string,
  kind: "photo" | "video",
  friendlyBaseName?: string,
): Promise<void> {
  if (kind === "video") return downloadVideo(url, friendlyBaseName ?? "ignite-video");
  return downloadImage(url, friendlyBaseName ?? "ignite-photo");
}

async function downloadVideoInner(url: string, friendlyBaseName: string, toastId: string | number): Promise<void> {
  const stamp = new Date().toISOString().split("T")[0];
  const resolvedUrl = await resolveSignedUrl(url);
  const ext = guessVideoExtensionFromUrl(resolvedUrl);
  const filename = `${friendlyBaseName}-${stamp}-${Date.now()}.${ext}`;
  const contentType = ext === "mov" ? "video/quicktime" : "video/mp4";

  if (!Capacitor.isNativePlatform()) {
    // Web: blob download with native <a download>.
    try {
      const response = await fetch(resolvedUrl, { credentials: "omit" });
      if (!response.ok) throw new Error(`Failed to fetch video (${response.status})`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      toast.success("Video downloaded", { id: toastId, description: filename });
    } catch (err) {
      console.warn("[downloadVideo] web blob failed:", err);
      safeOpenUrl(resolvedUrl);
      toast.success("Video opened in new tab", { id: toastId });
    }
    return;
  }

  const platform = Capacitor.getPlatform();
  toast.loading("Downloading video…", { id: toastId, description: "0%" });

  if (platform === "android") {
    try {
      const { Media } = await loadOptionalNativeModule("@capacitor-community/media");
      const albumIdentifier = await ensureAndroidMediaAlbum(Media as any, "Ignite");
      const baseName = `${friendlyBaseName}-${stamp}-${Date.now()}`;
      const saved = await (Media as any).saveVideo({
        path: resolvedUrl,
        fileName: baseName,
        albumIdentifier,
      }) as { filePath?: string };
      showOpenDownloadedToast(toastId, saved.filePath || null, "video", contentType, "Saved to Photos");
      return;
    } catch (err) {
      console.warn("[downloadVideo] android Media.saveVideo failed:", err);
    }
  }

  // iOS / Android fallback: download to cache then share/save via Photos.
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    let progressHandle: { remove: () => void } | null = null;
    try {
      progressHandle = await (Filesystem as any).addListener?.("progress", (ev: { bytes: number; contentLength: number }) => {
        if (!ev?.contentLength) return;
        const pct = Math.min(99, Math.round((ev.bytes / ev.contentLength) * 100));
        toast.loading("Downloading video…", { id: toastId, description: `${pct}%` });
      });
    } catch {
      progressHandle = null;
    }
    const dl = await Filesystem.downloadFile({
      url: resolvedUrl,
      path: filename,
      directory: Directory.Cache,
      recursive: true,
      progress: true,
    } as any) as DownloadResultWithLegacyUri;
    progressHandle?.remove?.();
    const localPath = dl?.uri || dl?.path || (await Filesystem.getUri({ path: filename, directory: Directory.Cache })).uri;
    if (!localPath) throw new Error("Download produced no local path");

    if (platform === "ios") {
      // Use the system share sheet — "Save Video" writes it to the Photos
      // app. This is the standard pattern WhatsApp/Telegram use on iOS for
      // video saves, because PHAsset video creation needs a file URL.
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({
          title: "Save video",
          text: "Save video",
          url: localPath,
          files: [localPath],
          dialogTitle: "Save video",
        });
        toast.success("Video ready", {
          id: toastId,
          description: "Tap Save Video in the share sheet",
          action: { label: "Open Photos", onClick: () => void openPhotosApp() },
        });
        return;
      } catch (shareErr: unknown) {
        const msg = getErrorText(shareErr).toLowerCase();
        if (msg.includes("cancel") || msg.includes("abort")) {
          toast.dismiss(toastId);
          return;
        }
        console.warn("[downloadVideo] iOS share failed:", shareErr);
      }
    }

    showOpenDownloadedToast(toastId, localPath, "video", contentType, "Downloaded");
  } catch (err) {
    console.warn("[downloadVideo] cache download failed:", err);
    toast.error("Download failed", { id: toastId, description: "Please try again" });
  }
}

async function openPhotosApp(): Promise<void> {
  try {
    if (Capacitor.getPlatform() === "ios") {
      // Apple's documented redirect scheme that launches the Photos app.
      await safeOpenUrl("photos-redirect://");
      return;
    }
    const { AppLauncher } = await import("@capacitor/app-launcher");
    // Try the MediaStore "view all images" content URI first — this opens
    // whichever gallery the user has set as default.
    try {
      const res = await AppLauncher.openUrl({ url: "content://media/external/images/media" });
      if (res?.completed) return;
    } catch (e) { console.warn("[openPhotosApp] content URI failed:", e); }

    const packages = [
      "com.google.android.apps.photos",
      "com.sec.android.gallery3d",
      "com.miui.gallery",
      "com.android.gallery3d",
    ];
    for (const pkg of packages) {
      try {
        const opened = await AppLauncher.openUrl({ url: pkg });
        if (opened?.completed) return;
      } catch { /* try next */ }
    }
    toast.error("Could not open Photos", { description: "Open it from your home screen" });
  } catch (err) {
    console.warn("[openPhotosApp] failed:", err);
    toast.error("Could not open Photos");
  }
}

function guessVideoExtensionFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const m = path.match(/\.(mp4|mov|m4v|webm|mkv)(?:$|\?)/);
    if (m) return m[1];
  } catch {
    return "mp4";
  }
  return "mp4";
}

async function downloadImageInner(url: string, friendlyBaseName: string, toastId: string | number): Promise<void> {
  const stamp = new Date().toISOString().split("T")[0];
  const resolvedUrl = await resolveSignedUrl(url);

  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform(); // "ios" | "android"
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");

      const urlExt = guessExtensionFromUrl(resolvedUrl);
      let filename = `${friendlyBaseName}-${stamp}-${Date.now()}.${urlExt}`;

      // ---- Android: save directly to the media library. Capacitor Filesystem
      // cannot place images in public Photos/Downloads on Android 10+ because
      // of scoped storage; using Share here is not a download and creates the
      // exact wrong UX. The Media plugin writes through Android MediaStore.
      if (platform === "android") {
        // Strategy: fetch the bytes once, write them to the app's sandboxed
        // Cache directory (so FileOpener can expose them via FileProvider for
        // the "Open" action), then ask the Media plugin to copy that local
        // file into the public Photos library. Using a local path for
        // Media.savePhoto is also more reliable than a remote URL — it
        // avoids the plugin's internal HTTP fetch (which can fail on signed
        // Supabase URLs) and gives us a single source of bytes.
        const response = await fetch(resolvedUrl);
        if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
        const blob = await response.blob();
        const contentType = blob.type || response.headers.get("content-type") || pickContentTypeFromExtension(urlExt);
        const ext = pickExtension(contentType) || urlExt;
        const baseName = `${friendlyBaseName}-${stamp}-${Date.now()}`;
        filename = `${baseName}.${ext}`;
        const base64 = await blobToBase64(blob);

        // 1. Write to app cache → gives us a sandbox path that FileOpener
        //    can open through the FileProvider that the plugin registers.
        const written = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
          recursive: true,
        });
        const cacheUri = written.uri || (await Filesystem.getUri({ path: filename, directory: Directory.Cache })).uri;

        // 2. Copy that local file into the public Photos library. Failure
        //    here is non-fatal — the user still has the cached copy and the
        //    Open action will work.
        let savedToGallery = false;
        try {
          const { Media } = await loadOptionalNativeModule("@capacitor-community/media");
          const albumIdentifier = await ensureAndroidMediaAlbum(Media, "Ignite");
          await Media.savePhoto({
            path: cacheUri,
            fileName: baseName,
            albumIdentifier,
          });
          savedToGallery = true;
        } catch (galleryErr) {
          console.warn("[downloadImage] Android MediaStore save failed:", galleryErr);
        }

        showOpenDownloadedPhotoToast(
          toastId,
          cacheUri,
          savedToGallery ? "Saved to your photos" : "Saved to app downloads",
          contentType,
        );
        return;
      }


      if (platform === "ios") {
        const ext = guessExtensionFromUrl(resolvedUrl);
        const contentType = pickContentTypeFromExtension(ext);
        const iosFilename = `${friendlyBaseName}-${stamp}-${Date.now()}.${ext}`;
        let localPath: string | null = null;

        const showSaved = () => {
          toast.success("Photo downloaded", {
            id: toastId,
            description: "Saved to Photos",
            action: { label: "Open", onClick: () => void openPhotosApp() },
          });
        };

        const saveWithIgnitePlugin = async (options: { url?: string; dataUrl?: string; base64?: string }, source: string): Promise<boolean> => {
          try {
            await IgnitePhotoSaver.savePhoto(options);
            showSaved();
            return true;
          } catch (nativeErr: unknown) {
            if (isPhotoPermissionError(nativeErr)) {
              toast.error("Photos permission needed", {
                id: toastId,
                description: "Enable Photos access for Ignite in iOS Settings to save downloads.",
              });
              return true;
            }
            console.warn(`[downloadImage] iOS IgnitePhotoSaver failed from ${source}:`, nativeErr);
            return false;
          }
        };

        // iOS needs a native Photos write. The community Media plugin currently
        // routes all inputs through SDWebImage download, which is exactly where
        // the user's signed/chat URLs were failing. Our app plugin downloads the
        // bytes with URLSession (or accepts data) and writes them directly via
        // PHAssetCreationRequest.
        if (await saveWithIgnitePlugin({ url: resolvedUrl }, "remote URL")) return;

        // Fallback 1: native URLSession download to app cache, then save the
        // cached bytes as a data URI. Capacitor Filesystem returns `path` on
        // native (not `uri`), so support both shapes.
        try {
          const dl = await Filesystem.downloadFile({
            url: resolvedUrl,
            path: iosFilename,
            directory: Directory.Cache,
            recursive: true,
          }) as DownloadResultWithLegacyUri;
          localPath = dl?.uri || dl?.path || null;
        } catch (nativeErr) {
          console.warn("[downloadImage] iOS Filesystem.downloadFile failed, falling back to fetch:", nativeErr);
        }

        if (localPath) {
          try {
            const read = await Filesystem.readFile({ path: iosFilename, directory: Directory.Cache });
            const dataUri = await fileReadResultToDataUri(read.data, contentType);
            if (await saveWithIgnitePlugin({ dataUrl: dataUri }, "cached data URI")) return;
          } catch (readErr) {
            console.warn("[downloadImage] iOS cached file read failed:", readErr);
          }
        }

        try {
          const response = await fetch(resolvedUrl, { credentials: "omit" });
          if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
          const blob = await response.blob();
          const dataUri = `data:${blob.type || contentType};base64,${await blobToBase64(blob)}`;
          if (await saveWithIgnitePlugin({ dataUrl: dataUri }, "fetch data URI")) return;
        } catch (fetchErr) {
          console.warn("[downloadImage] iOS fetch fallback failed:", fetchErr);
        }

        // Last resort: share the cached local file if one exists, otherwise give
        // a truthful error. This path should only be reached if both native
        // save/download mechanisms and the WebView fetch failed.
        if (localPath) {
          try {
            const { Share } = await import("@capacitor/share");
            await Share.share({
              title: "Save photo",
              files: [localPath],
              dialogTitle: "Save photo",
            });
            toast.success("Photo ready", {
              id: toastId,
              description: "Tap Save Image in the share sheet",
            });
          } catch (shareErr: unknown) {
            const msg = getErrorText(shareErr).toLowerCase();
            if (msg.includes("cancel") || msg.includes("abort")) {
              toast.dismiss(toastId);
              return;
            }
            console.warn("[downloadImage] iOS share fallback failed:", shareErr);
            toast.error("Download failed", { id: toastId, description: "Please try again" });
          }
          return;
        }

        toast.error("Download failed", { id: toastId, description: "Could not save this photo. Please try again." });
        return;
      }

      // ---- Other native fallback: write to cache then open share sheet
      let writtenUri: string | null = null;
      try {
        const dl = await Filesystem.downloadFile({
          url: resolvedUrl,
          path: filename,
          directory: Directory.Cache,
          recursive: true,
        }) as DownloadResultWithLegacyUri;
        writtenUri = dl?.uri || dl?.path || null;
        if (!writtenUri) {
          const uriResult = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
          writtenUri = uriResult.uri;
        }
      } catch (dlErr) {
        console.warn("[downloadImage] Filesystem.downloadFile failed, trying fetch:", dlErr);
      }

      if (!writtenUri) {
        const response = await fetch(resolvedUrl);
        if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
        const blob = await response.blob();
        const contentType = blob.type || response.headers.get("content-type") || "image/jpeg";
        const ext = pickExtension(contentType);
        filename = `${friendlyBaseName}-${stamp}-${Date.now()}.${ext}`;
        const base64 = await blobToBase64(blob);
        const written = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
          recursive: true,
        });
        writtenUri = written.uri || (await Filesystem.getUri({ path: filename, directory: Directory.Cache })).uri;
      }

      const finalUri = writtenUri;
      if (!finalUri) {
        toast.error("Download failed", { id: toastId, description: "Could not save file" });
        return;
      }
      toast.success("Photo downloaded", {
        id: toastId,
        description: "Tap Open to save or share",
        action: {
          label: "Open",
          onClick: async () => {
            try {
              const { Share } = await import("@capacitor/share");
              await Share.share({
                title: "Save photo",
                text: "Save photo",
                url: finalUri,
                files: [finalUri],
                dialogTitle: "Save photo",
              });
            } catch (shareErr: unknown) {
              const msg = getErrorText(shareErr);
              if (!msg.toLowerCase().includes("cancel")) {
                console.warn("[downloadImage] share failed:", shareErr);
                toast.error("Could not open file", { description: msg });
              }
            }
          },
        },
      });
      return;
    } catch (err) {
      console.warn("[downloadImage] native download failed:", err);
      toast.error("Download failed", { id: toastId, description: "Please try again" });
      return;
    }
  }

  try {
    const response = await fetch(resolvedUrl, { credentials: "omit" });
    if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
    const blob = await response.blob();

    const contentType = blob.type || response.headers.get("content-type") || "";
    const ext = pickExtension(contentType);
    const filename = `${friendlyBaseName}-${stamp}-${Date.now()}.${ext}`;

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Keep blob URL alive so the toast "Open" action still works after the download.
    // Revoke it after a longer delay (toast lifetime + buffer).
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    toast.success("Photo downloaded", {
      id: toastId,
      description: filename,
    });
  } catch (err) {
    console.warn("[downloadImage] blob download failed, falling back to open:", err);
    safeOpenUrl(resolvedUrl);
    toast.success("Photo opened in new tab", { id: toastId });
  }
}

function showOpenDownloadedPhotoToast(
  toastId: string | number,
  filePath: string | null,
  description: string,
  contentType: string,
) {
  showOpenDownloadedToast(toastId, filePath, "photo", contentType, description);
}

function showOpenDownloadedToast(
  toastId: string | number,
  filePath: string | null,
  kind: "photo" | "video",
  contentType: string,
  description?: string,
) {
  const title = kind === "video" ? "Video downloaded" : "Photo downloaded";
  const fallbackType = kind === "video" ? "video/*" : "image/*";
  const desc = description ?? "Saved to Photos";

  const handleOpen = async () => {
    console.log("[downloadMedia] Open tapped. filePath=", filePath, "contentType=", contentType);
    const platform = Capacitor.getPlatform();
    let opened = false;

    const candidates: string[] = [];
    if (filePath) {
      candidates.push(filePath);
      if (/^\/(?:storage|sdcard|data)\//.test(filePath)) {
        candidates.push(`file://${filePath}`);
      }
    }

    if (candidates.length > 0) {
      try {
        const { FileOpener } = await loadOptionalNativeModule("@capacitor-community/file-opener");
        for (const p of candidates) {
          try {
            await FileOpener.open({ filePath: p, contentType: contentType || fallbackType });
            opened = true;
            break;
          } catch (innerErr) {
            console.warn("[downloadMedia] FileOpener failed for", p, innerErr);
          }
        }
      } catch (importErr) {
        console.warn("[downloadMedia] FileOpener import failed:", importErr);
      }

      if (!opened && platform === "android") {
        try {
          const { AppLauncher } = await import("@capacitor/app-launcher");
          for (const p of candidates) {
            if (!p.startsWith("content://")) continue;
            try {
              const res = await AppLauncher.openUrl({ url: p });
              if (res?.completed) { opened = true; break; }
            } catch (alErr) {
              console.warn("[downloadMedia] AppLauncher openUrl failed for", p, alErr);
            }
          }
        } catch (alImportErr) {
          console.warn("[downloadMedia] AppLauncher import failed:", alImportErr);
        }
      }
    }

    if (opened) {
      toast.dismiss(toastId);
      return;
    }

    // Couldn't open the file directly — fall back to the gallery app and
    // tell the user where to look, instead of silently doing nothing.
    toast.dismiss(toastId);
    await openPhotosApp();
    toast.message("Open your gallery", {
      description: kind === "video"
        ? "Find your video in the Ignite album."
        : "Find your photo in the Ignite album.",
    });
  };

  toast.custom(
    (id) => (
      <DownloadSuccessToast
        toastId={id}
        title={title}
        description={desc}
        onOpen={handleOpen}
      />
    ),
    { id: toastId, duration: 8000 },
  );
}





function pickContentTypeFromExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // strip data:*/*;base64, prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fileReadResultToDataUri(data: string | Blob, contentType: string): Promise<string> {
  if (typeof data === "string") {
    return data.startsWith("data:") ? data : `data:${contentType};base64,${data}`;
  }

  return `data:${data.type || contentType};base64,${await blobToBase64(data)}`;
}

function isPhotoPermissionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null | undefined;
  const message = String(e?.message || err || "").toLowerCase();
  const code = String(e?.code || "").toLowerCase();

  return (
    code.includes("access_denied") ||
    message.includes("access to photos not allowed") ||
    message.includes("permission") ||
    message.includes("denied") ||
    message.includes("not authorized")
  );
}

function getErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}

function pickExtension(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("heic")) return "heic";
  if (ct.includes("heif")) return "heif";
  if (ct.includes("svg")) return "svg";
  return "jpg";
}

function guessExtensionFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const m = path.match(/\.(png|webp|gif|heic|heif|svg|jpg|jpeg)(?:$|\?)/);
    if (m) return m[1] === "jpeg" ? "jpg" : m[1];
  } catch {
    return "jpg";
  }
  return "jpg";
}

async function ensureAndroidMediaAlbum(
  Media: {
    getAlbums: () => Promise<{ albums?: Array<{ name?: string; identifier?: string }> }>;
    createAlbum: (options: { name: string }) => Promise<void>;
    getAlbumsPath?: () => Promise<{ path?: string }>;
  },
  albumName: string,
): Promise<string> {
  const findAlbum = async () => {
    const { albums = [] } = await Media.getAlbums();
    const albumsPath = Media.getAlbumsPath ? (await Media.getAlbumsPath().catch(() => ({ path: undefined }))).path : undefined;
    return albums.find((album) =>
      album.name === albumName &&
      album.identifier &&
      (!albumsPath || album.identifier.startsWith(albumsPath))
    ) || albums.find((album) => album.name === albumName && album.identifier);
  };

  const existing = await findAlbum();
  if (existing?.identifier) return existing.identifier;

  try {
    await Media.createAlbum({ name: albumName });
  } catch (err: unknown) {
    const message = getErrorText(err).toLowerCase();
    if (!message.includes("already exists")) throw err;
  }

  const created = await findAlbum();
  if (!created?.identifier) throw new Error("Could not prepare Android photo album");
  return created.identifier;
}
