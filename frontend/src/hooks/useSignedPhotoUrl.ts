import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

// In-memory cache for signed URLs (hydrated from localStorage on load)
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const LS_KEY = "signed-url-cache-v1";

// Cache duration: 50 minutes (signed URLs valid for 60 minutes)
const CACHE_DURATION_MS = 50 * 60 * 1000;
const SIGNED_URL_EXPIRES_IN_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 5000;
const PRIVATE_BUCKETS = ["photos", "chat-attachments", "avatars"] as const;

type PrivateBucket = (typeof PRIVATE_BUCKETS)[number];

try {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, { url: string; expiresAt: number }>;
    const now = Date.now();
    let kept = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.url === "string" && v.expiresAt > now) {
        urlCache.set(k, v);
        if (++kept > 500) break;
      }
    }
  }
} catch {
  /* ignore */
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (typeof localStorage === "undefined" || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const obj: Record<string, { url: string; expiresAt: number }> = {};
      const now = Date.now();
      let n = 0;
      for (const [k, v] of urlCache) {
        if (v.expiresAt > now) {
          obj[k] = v;
          if (++n >= 500) break;
        }
      }
      localStorage.setItem(LS_KEY, JSON.stringify(obj));
    } catch {
      /* quota exceeded etc. — ignore */
    }
  }, 1000);
}

// `T` defaults to `any` because every current caller passes a promise from
// the fail-closed `supabase: any` client (src/integrations/supabase/client.ts).
// Without the default, TypeScript's generic inference for an unconstrained
// type parameter resolves an `any`-typed argument to `{}` here, which erases
// the `{ data, error }` shape callers destructure and manufactures
// "Property does not exist" diagnostics unrelated to any real behavior
// change. A genuinely typed promise argument still infers its own type
// (the default only applies when there is nothing concrete to infer from).
function withTimeout<T = any>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function extractPrivateStoragePath(url: string): { bucket: PrivateBucket; path: string } | null {
  const cleanUrl = url.split("#")[0];
  const urlWithoutQuery = cleanUrl.split("?")[0];

  for (const bucket of PRIVATE_BUCKETS) {
    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/authenticated/${bucket}/`,
      `/storage/v1/render/image/public/${bucket}/`,
      `/storage/v1/render/image/sign/${bucket}/`,
    ];

    for (const marker of markers) {
      if (!urlWithoutQuery.includes(marker)) continue;

      const rawPath = urlWithoutQuery.split(marker)[1] ?? "";
      if (!rawPath) return null;

      const trimmedPath = rawPath.replace(/^\/+/, "");
      const decodedPath = (() => {
        try {
          return decodeURIComponent(trimmedPath);
        } catch {
          return trimmedPath;
        }
      })();

      return decodedPath ? { bucket, path: decodedPath } : null;
    }
  }

  return null;
}

async function createSignedUrlDirect(url: string): Promise<string | null> {
  const privatePath = extractPrivateStoragePath(url);
  if (!privatePath) return null;

  const { bucket, path } = privatePath;
  const { data, error } = await withTimeout(
    supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS),
    REQUEST_TIMEOUT_MS,
    "createSignedUrl timed out"
  );

  if (error || !data?.signedUrl) {
    console.warn("[useSignedPhotoUrl] Direct signed URL failed:", error?.message || "unknown");
    return null;
  }

  return data.signedUrl;
}

async function createSignedUrlViaFunction(url: string): Promise<string | null> {
  const privatePath = extractPrivateStoragePath(url);
  if (!privatePath) return null;

  const { data, error } = await withTimeout(
    supabase.functions.invoke("get-signed-photo-url", {
      body: { paths: [url], expiresIn: SIGNED_URL_EXPIRES_IN_SECONDS },
    }),
    REQUEST_TIMEOUT_MS,
    "get-signed-photo-url timed out"
  );

  if (error) {
    console.warn("[useSignedPhotoUrl] Edge signed URL fallback failed:", error.message || "unknown");
    return null;
  }

  const signed = (data as { signedUrls?: Record<string, string> } | null)?.signedUrls?.[url];
  return typeof signed === "string" && signed.length > 0 ? signed : null;
}


export async function resolveSignedUrl(url: string): Promise<string> {
  const privatePath = extractPrivateStoragePath(url);
  if (!privatePath) {
    return url;
  }

  // Direct SDK call is fastest, but never fall back to the raw URL for private
  // bucket objects. Those are often stored as `/object/public/...` legacy URLs
  // even though the bucket is private, and loading them directly returns a 400
  // "Bucket not found" placeholder instead of the image.
  const directSignedUrl = await createSignedUrlDirect(url);
  if (directSignedUrl) return directSignedUrl;

  const functionSignedUrl = await createSignedUrlViaFunction(url);
  if (functionSignedUrl) return functionSignedUrl;

  throw new Error("Unable to create signed URL for private storage object");
}

function readCachedSignedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const cached = urlCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  // If the URL doesn't need signing, treat it as immediately resolvable so
  // virtualised chat rows don't flash a skeleton on remount.
  if (!extractPrivateStoragePath(url)) return url;
  return null;
}

export function useSignedPhotoUrl(originalUrl: string | null | undefined) {
  // Synchronous cache hydration is critical for virtualised chat: if we
  // start with `null` and resolve in an effect, every row remount during a
  // fast back-scroll shows the skeleton for one frame before the cached
  // signed URL re-applies. That looks like images "shaking" / flashing.
  const [signedUrl, setSignedUrl] = useState<string | null>(() => readCachedSignedUrl(originalUrl));
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!originalUrl) {
      setSignedUrl(null);
      setIsLoading(false);
      return;
    }

    const cachedNow = readCachedSignedUrl(originalUrl);
    if (cachedNow) {
      setSignedUrl(cachedNow);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const fetchSignedUrl = async () => {
      setIsLoading(true);

      try {
        const resolvedUrl = await resolveSignedUrl(originalUrl);

        if (resolvedUrl !== originalUrl) {
          urlCache.set(originalUrl, {
            url: resolvedUrl,
            expiresAt: Date.now() + CACHE_DURATION_MS,
          });
          schedulePersist();
        }

        if (!isCancelled) {
          setSignedUrl(resolvedUrl);
        }
      } catch (error) {
        console.error("Error fetching signed URL:", error);
        if (!isCancelled) {
          setSignedUrl(null);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchSignedUrl();

    return () => {
      isCancelled = true;
    };
  }, [originalUrl]);

  return { signedUrl, isLoading };
}

// Batch fetch signed URLs for multiple photos
export async function getSignedPhotoUrls(urls: string[]): Promise<Record<string, string>> {
  if (urls.length === 0) return {};

  const result: Record<string, string> = {};
  const uncachedUrls: string[] = [];

  for (const url of urls) {
    const cached = urlCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      result[url] = cached.url;
    } else {
      uncachedUrls.push(url);
    }
  }

  if (uncachedUrls.length === 0) return result;

  const resolved = await Promise.all(
    uncachedUrls.map(async (url) => {
      try {
        return [url, await resolveSignedUrl(url)] as const;
      } catch (error) {
        console.error("Error resolving signed URL:", error);
        return [url, null] as const;
      }
    })
  );

  let anySuccess = false;
  for (const [originalUrl, resolvedUrl] of resolved) {
    // Failed private-URL signings: omit from result entirely so callers
    // never receive the raw private URL as a "successful" resolution.
    if (!resolvedUrl) continue;

    result[originalUrl] = resolvedUrl;

    if (resolvedUrl !== originalUrl) {
      urlCache.set(originalUrl, {
        url: resolvedUrl,
        expiresAt: Date.now() + CACHE_DURATION_MS,
      });
      anySuccess = true;
    }
  }
  if (anySuccess) schedulePersist();

  return result;
}

// Clear cache (useful for logout)
export function clearSignedUrlCache() {
  urlCache.clear();
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
