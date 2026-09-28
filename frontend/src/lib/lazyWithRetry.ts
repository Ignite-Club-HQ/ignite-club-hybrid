import { lazy, type ComponentType } from "react";

/**
 * Resilient wrapper around React.lazy.
 *
 * After a new app version is deployed, the previously loaded HTML references
 * hashed chunk files that no longer exist on the CDN. Any dynamic import then
 * fails with "Failed to fetch dynamically imported module", which surfaces as a
 * full-screen "Something went wrong" error.
 *
 * Strategy:
 *  1. Retry the import a couple of times with a short backoff (covers transient
 *     network blips / cold starts).
 *  2. If it still fails, reload the app once (guarded by sessionStorage so we
 *     can never loop) so the browser picks up the new chunk manifest.
 */

const RELOAD_GUARD_KEY = "ignite_chunk_reload_at";
const RELOAD_GUARD_WINDOW_MS = 30_000;

function shouldAttemptReload(): boolean {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_GUARD_KEY);
    const last = raw ? Number(raw) : 0;
    if (Number.isFinite(last) && Date.now() - last < RELOAD_GUARD_WINDOW_MS) {
      return false;
    }
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Loading chunk .* failed/i.test(message) ||
    /ChunkLoadError/i.test(message)
  );
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  { retries = 2, backoffMs = 350 }: { retries?: number; backoffMs?: number } = {},
) {
  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await factory();
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await delay(backoffMs * (attempt + 1));
        }
      }
    }

    if (isChunkLoadError(lastError) && typeof window !== "undefined" && shouldAttemptReload()) {
      window.location.reload();
      // Keep the promise pending while the reload happens so no error UI flashes.
      await new Promise(() => {});
    }

    throw lastError;
  });
}
