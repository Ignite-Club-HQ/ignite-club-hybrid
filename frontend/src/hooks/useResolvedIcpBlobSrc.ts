import * as React from "react";
import { getActiveIcpTarget } from "@/live/targetRegistry";
import { listBlobStoreCanisterIds } from "@/live/mediaStorage";
import { localUploadPreviews } from "@/components/media/localUploadPreviews";
import { useOptionalAuth } from "@/hooks/useAuth";

/**
 * ICP media (profile photos, club logos, sponsor images) lives on the
 * media_blob_store canister as IBE ciphertext, so those URLs cannot be handed
 * to <img> directly. When `src` points at a configured blob store, resolve it
 * to a decrypted object URL (same path as chat/media photos). Everything else
 * passes through untouched and synchronously, so Supabase-mode images render
 * exactly as before.
 *
 * Resolved object URLs are cached for the session. Failures (no decrypt grant
 * yet, offline) are retried after a cooldown instead of on every remount.
 */
const decryptedCache = new Map<string, string>();
const failedCache = new Map<string, number>();
const inFlight = new Map<string, Promise<string | null>>();
const failureCounts = new Map<string, number>();
// Resuming the app often fails the first unlock while the connection wakes
// up; retry quickly first instead of showing no avatar for a whole minute.
const FAILURE_BACKOFF_MS = [3_000, 10_000, 30_000, 60_000];
const retryDelay = (key: string) => FAILURE_BACKOFF_MS[Math.min((failureCounts.get(key) ?? 1) - 1, FAILURE_BACKOFF_MS.length - 1)];
const markFailed = (key: string) => { failedCache.set(key, Date.now()); failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1); };

export function isIcpBlobUrl(src: string): boolean {
  try {
    const target = getActiveIcpTarget();
    const stores = listBlobStoreCanisterIds(target);
    const url = new URL(src);
    // A new group's store is not in the shared target's static IDs. Club
    // paths still need asynchronous approved-owner resolution, never <img>
    // with the raw ciphertext URL, even before routing has warmed up.
    const clubPath = /^\/clubs\/[^/]+\//.test(url.pathname);
    if (url.hostname === "icp0.io" || url.hostname === "raw.icp0.io") {
      return stores.includes(url.pathname.replace(/^\/+/, "").split("/")[0]);
    }
    const sub = /^([a-z0-9-]+)\.(?:raw\.)?icp0\.io$/.exec(url.hostname)?.[1];
    return !!sub && (stores.includes(sub) || clubPath);
  } catch {
    return false;
  }
}

export interface ResolvedIcpBlobSrc {
  /** Displayable URL (decrypted object URL for ICP blobs, else the input). */
  src: string | undefined;
  /** True while an ICP blob is still being decrypted. */
  pending: boolean;
  /** True when decryption failed (show the fallback). */
  failed: boolean;
}

export function useResolvedIcpBlobSrc(src: string | undefined | null): ResolvedIcpBlobSrc {
  const auth = useOptionalAuth();
  const user = auth?.user;
  const sessionRestoration = auth?.sessionRestoration ?? "signed-out";
  const input = src ?? undefined;
  const cacheKey = `${user?.id ?? "signed-out"}:${input ?? ""}`;
  const ready = sessionRestoration === "authenticated" && !!user;
  const compute = (): ResolvedIcpBlobSrc => {
    if (!input || !isIcpBlobUrl(input)) return { src: input, pending: false, failed: false };
    // Do not turn a still-restoring session into a minute-long image failure.
    if (!ready) return { src: undefined, pending: sessionRestoration === "restoring", failed: false };
    const preview = localUploadPreviews.get(input);
    if (preview) return { src: preview, pending: false, failed: false };
    const cached = decryptedCache.get(cacheKey);
    if (cached) return { src: cached, pending: false, failed: false };
    const failedAt = failedCache.get(cacheKey);
    if (failedAt && Date.now() - failedAt < retryDelay(cacheKey)) {
      return { src: undefined, pending: false, failed: true };
    }
    return { src: undefined, pending: true, failed: false };
  };
  const [state, setState] = React.useState<ResolvedIcpBlobSrc>(compute);
  const [retryEpoch, retry] = React.useReducer((value: number) => value + 1, 0);

  // A cold refresh can mount the cached header before sign-in is restored.
  // Failed unlocks must not latch the header onto its fallback indefinitely.
  React.useEffect(() => {
    if (!input || !state.failed) return;
    const retryAfterCooldown = () => {
      if (navigator.onLine === false) return;
      const failedAt = failedCache.get(cacheKey);
      if (failedAt && Date.now() - failedAt < retryDelay(cacheKey)) return;
      retry();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retryAfterCooldown();
    };
    const remaining = Math.max(0, retryDelay(cacheKey) - (Date.now() - (failedCache.get(cacheKey) ?? 0)));
    const timer = window.setTimeout(retryAfterCooldown, remaining);
    window.addEventListener("online", retryAfterCooldown);
    window.addEventListener("focus", retryAfterCooldown);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", retryAfterCooldown);
      window.removeEventListener("focus", retryAfterCooldown);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [input, cacheKey, state.failed, retryEpoch]);

  React.useEffect(() => {
    const next = compute();
    setState(next);
    if (!next.pending || !input || !ready) return;
    let cancelled = false;
    // Dynamic import: the decrypt path pulls in the vetKeys SDK, which must
    // stay out of the initial bundle for Supabase sessions.
    // Header, sidebar and club switcher often request the same logo together.
    // Share its download/key unlock instead of paying for each mounted image.
    let request = inFlight.get(cacheKey);
    if (!request) {
      request = import("@/live/mediaDecrypt")
        .then((m) => m.resolveIcpBlobObjectUrl(input))
        .then((url) => {
          if (url) { decryptedCache.set(cacheKey, url); failureCounts.delete(cacheKey); }
          else markFailed(cacheKey);
          return url;
        })
        .catch((error: unknown) => {
          markFailed(cacheKey);
          throw error;
        })
        .finally(() => { inFlight.delete(cacheKey); });
      inFlight.set(cacheKey, request);
    }
    request
      .then((url) => {
        if (!cancelled) setState({ src: url ?? undefined, pending: false, failed: !url });
      })
      .catch(() => {
        if (!cancelled) setState({ src: undefined, pending: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, cacheKey, ready, sessionRestoration, retryEpoch]);

  return state;
}
