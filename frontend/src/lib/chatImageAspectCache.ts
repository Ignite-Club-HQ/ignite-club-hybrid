// Persistent cache of chat image aspect ratios (width / height), keyed by the
// raw storage URL/path (NOT the signed URL — signed URLs rotate per session).
//
// Why this exists:
//   MessageContent reserves a 4:3 box for every image before decode. When the
//   real ratio differs (portrait photos especially), the wrapper resizes once
//   the image loads and Virtuoso has to correct row heights below — visible
//   as "the area grows after the image populates".
//
//   A module-level in-memory Map already absorbs this on re-mounts within a
//   session, but the very first paint after a reload always falls back to 4:3.
//   Persisting the cache to localStorage means once an image has been seen on
//   the device, subsequent loads reserve the correct height before decode.
//
// User-scoped per project rule: stored under the `ignite_` prefix so
// `clearUserScopedCaches()` sweeps it on auth transitions.

const STORAGE_KEY = "ignite_chat_image_ratios_v1";
const MAX_ENTRIES = 800;
const WRITE_DEBOUNCE_MS = 1500;
const MIN_CHAT_ASPECT_RATIO = 3 / 4;
const MAX_CHAT_ASPECT_RATIO = 16 / 9;

type Ratios = Record<string, number>;

function clampChatAspectRatio(ratio: number): number {
  return Math.min(MAX_CHAT_ASPECT_RATIO, Math.max(MIN_CHAT_ASPECT_RATIO, ratio));
}

const memory: Map<string, number> = (globalThis as any).__chatImageAspectRatios
  ?? ((globalThis as any).__chatImageAspectRatios = new Map<string, number>());

let loaded = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function loadOnce() {
  if (loaded) return;
  loaded = true;
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Ratios;
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) {
          memory.set(k, clampChatAspectRatio(v));
        }
      }
    }
  } catch {
    /* corrupt entry — ignore */
  }
}

function scheduleWrite() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      if (typeof localStorage === "undefined") return;
      // Cap size — drop oldest insertions (Map preserves insertion order).
      if (memory.size > MAX_ENTRIES) {
        const excess = memory.size - MAX_ENTRIES;
        const keys = Array.from(memory.keys()).slice(0, excess);
        for (const k of keys) memory.delete(k);
      }
      const obj: Ratios = {};
      for (const [k, v] of memory) obj[k] = v;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      /* quota / unavailable — silent */
    }
  }, WRITE_DEBOUNCE_MS);
}

// Strip query string + fragment so signed URLs and raw storage paths collide
// on the same underlying object.
function normalizeKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf("?");
  const base = q >= 0 ? url.slice(0, q) : url;
  return base || null;
}

// Parse ?w=W&h=H (or w/h anywhere in the query string) into an aspect ratio.
// We append these params at upload time so the very first paint — even for
// receivers who have never seen this image — can reserve the exact box and
// avoid post-load row-height jolts.
function extractRatioFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const q = url.indexOf("?");
  if (q < 0) return null;
  const qs = url.slice(q + 1);
  let w = 0;
  let h = 0;
  for (const pair of qs.split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const k = pair.slice(0, eq);
    const v = pair.slice(eq + 1);
    if (k === "w") w = parseInt(v, 10) || 0;
    else if (k === "h") h = parseInt(v, 10) || 0;
    if (w && h) break;
  }
  if (w > 0 && h > 0) return clampChatAspectRatio(w / h);
  return null;
}

export function getCachedImageAspectRatio(
  urls: (string | null | undefined)[],
): number | null {
  loadOnce();
  for (const u of urls) {
    const k = normalizeKey(u);
    if (k && memory.has(k)) return memory.get(k) ?? null;
  }
  // Fallback: dimensions encoded in the URL itself (?w=&h=). Populate the
  // in-memory cache so subsequent lookups are O(1).
  for (const u of urls) {
    const r = extractRatioFromUrl(u);
    if (r) {
      const k = normalizeKey(u);
      if (k) memory.set(k, r);
      return r;
    }
  }
  return null;
}


export function setCachedImageAspectRatio(
  urls: (string | null | undefined)[],
  ratio: number,
): void {
  loadOnce();
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  const clampedRatio = clampChatAspectRatio(ratio);
  let changed = false;
  for (const u of urls) {
    const k = normalizeKey(u);
    if (!k) continue;
    if (memory.get(k) !== clampedRatio) {
      memory.set(k, clampedRatio);
      changed = true;
    }
  }
  if (changed) scheduleWrite();
}

// Off-screen pre-decode for chat image URLs entering Virtuoso's prefetch
// window. Populates the aspect-ratio cache BEFORE the row mounts so the
// estimator reserves the correct box on first paint instead of the 4:3
// default — eliminates the post-decode row-grow / row-shrink jolt that
// causes visible flicker after upward scroll-pages land.
//
// No-ops when the URL is already cached (including the ?w=&h= URL-encoded
// fast path) or when called in a non-DOM environment.
const inFlight = new Set<string>();
export function prefetchChatImageAspectRatio(url: string | null | undefined): void {
  if (!url) return;
  if (typeof Image === "undefined") return;
  loadOnce();
  const k = normalizeKey(url);
  if (!k) return;
  if (memory.has(k)) return;
  if (extractRatioFromUrl(url)) return; // URL already encodes dims
  if (inFlight.has(k)) return;
  inFlight.add(k);
  try {
    const img = new Image();
    img.decoding = "async";
    (img as unknown as { fetchPriority?: string }).fetchPriority = "low";

    img.onload = () => {
      inFlight.delete(k);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w > 0 && h > 0) setCachedImageAspectRatio([url], w / h);
    };
    img.onerror = () => { inFlight.delete(k); };
    img.src = url;
  } catch {
    inFlight.delete(k);
  }
}


// Measure intrinsic pixel dimensions of an image Blob. Returns null if the
// blob can't be decoded as an image (e.g. SVG without dims, corrupt file).
// Cheap and best-effort — callers should not block uploads on failure.
export async function measureImageDimensions(
  blob: Blob,
): Promise<{ width: number; height: number } | null> {
  // Prefer createImageBitmap (off-main-thread on most engines, no DOM dep).
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(blob);
      const w = bmp.width;
      const h = bmp.height;
      try { bmp.close?.(); } catch { /* ignore */ }
      if (w > 0 && h > 0) return { width: w, height: h };
    }
  } catch {
    /* fall through to <img> fallback */
  }
  // Fallback: HTMLImageElement decode.
  try {
    if (typeof URL === "undefined" || typeof Image === "undefined") return null;
    const objUrl = URL.createObjectURL(blob);
    try {
      const dims = await new Promise<{ width: number; height: number } | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = objUrl;
      });
      return dims && dims.width > 0 && dims.height > 0 ? dims : null;
    } finally {
      try { URL.revokeObjectURL(objUrl); } catch { /* ignore */ }
    }
  } catch {
    return null;
  }
}

// Append ?w=&h= (or merge into existing query) so the dimensions survive in
// the persisted message row and are available to every receiver on first
// paint — no extra DB columns needed.
export function appendDimensionsToUrl(
  url: string,
  width: number,
  height: number,
): string {
  if (!url || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return url;
  }
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}w=${Math.round(width)}&h=${Math.round(height)}`;
}
