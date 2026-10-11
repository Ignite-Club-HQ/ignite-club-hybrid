import * as React from "react";
import { getActiveIcpTarget } from "@/live/targetRegistry";
import { listBlobStoreCanisterIds } from "@/live/mediaStorage";
import { localUploadPreviews } from "@/components/media/localUploadPreviews";

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
const FAILURE_RETRY_MS = 60_000;

export function isIcpBlobUrl(src: string): boolean {
  try {
    const target = getActiveIcpTarget();
    const stores = listBlobStoreCanisterIds(target);
    if (stores.length === 0) return false;
    const url = new URL(src);
    if (url.hostname === "icp0.io" || url.hostname === "raw.icp0.io") {
      return stores.includes(url.pathname.replace(/^\/+/, "").split("/")[0]);
    }
    const sub = /^([a-z0-9-]+)\.(?:raw\.)?icp0\.io$/.exec(url.hostname)?.[1];
    return !!sub && stores.includes(sub);
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
  const input = src ?? undefined;
  const compute = (): ResolvedIcpBlobSrc => {
    if (!input || !isIcpBlobUrl(input)) return { src: input, pending: false, failed: false };
    const preview = localUploadPreviews.get(input);
    if (preview) return { src: preview, pending: false, failed: false };
    const cached = decryptedCache.get(input);
    if (cached) return { src: cached, pending: false, failed: false };
    const failedAt = failedCache.get(input);
    if (failedAt && Date.now() - failedAt < FAILURE_RETRY_MS) {
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
      const failedAt = failedCache.get(input);
      if (failedAt && Date.now() - failedAt < FAILURE_RETRY_MS) return;
      retry();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retryAfterCooldown();
    };
    const remaining = Math.max(0, FAILURE_RETRY_MS - (Date.now() - (failedCache.get(input) ?? 0)));
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
  }, [input, state.failed, retryEpoch]);

  React.useEffect(() => {
    const next = compute();
    setState(next);
    if (!next.pending || !input) return;
    let cancelled = false;
    // Dynamic import: the decrypt path pulls in the vetKeys SDK, which must
    // stay out of the initial bundle for Supabase sessions.
    import("@/live/mediaDecrypt")
      .then((m) => m.resolveIcpBlobObjectUrl(input))
      .then((url) => {
        if (url) decryptedCache.set(input, url);
        else failedCache.set(input, Date.now());
        if (!cancelled) setState({ src: url ?? undefined, pending: false, failed: !url });
      })
      .catch(() => {
        failedCache.set(input, Date.now());
        if (!cancelled) setState({ src: undefined, pending: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, retryEpoch]);

  return state;
}
