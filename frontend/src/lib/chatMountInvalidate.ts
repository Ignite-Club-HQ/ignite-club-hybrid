/**
 * Batch 3A — Skip on-mount `invalidateQueries` for chat surfaces when the
 * cached data is provably fresh and safe to reuse.
 *
 * Background: every chat page (Group / Team / Club / DM / Broadcast) fires
 * `queryClient.invalidateQueries([...messageKey...])` in a mount effect to
 * guarantee push-notification / inbox-tap landings show the newest row.
 * On warm cache (inbox preload, realtime patch, or back-nav within seconds)
 * this kicks off a redundant ~400–800ms round-trip AND causes an "anchor:
 * reset" pass on Virtuoso that visibly re-jolts the scroll position.
 *
 * `shouldSkipChatMountInvalidate` returns true ONLY when ALL of these hold:
 *   1. The cached query has data and was updated < FRESH_WINDOW_MS ago.
 *   2. The realtime websocket is currently connected (so any out-of-band
 *      writes during this window will arrive as patches).
 *   3. The page is currently visible AND has NOT just transitioned from
 *      hidden → visible within REVISIBLE_GRACE_MS (covers "phone locked
 *      for 2 minutes" — must refetch when waking).
 *   4. The global kill switch flag is not engaged.
 *
 * Kill switches (any one re-enables the always-invalidate behaviour):
 *   - localStorage['ignite_disable_chat_mount_skip'] === '1'
 *   - window.__disableChatMountInvalidateSkip === true
 *
 * Telemetry: emits `[ChatMountInvalidate]` console logs with reason so we
 * can confirm hit rate before considering this safe to keep long-term.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const FRESH_WINDOW_MS = 3_000;
const REVISIBLE_GRACE_MS = 8_000;

let lastBecameVisibleAt = 0;
let visibilityListenerInstalled = false;

function installVisibilityListener(): void {
  if (visibilityListenerInstalled) return;
  if (typeof document === "undefined") return;
  visibilityListenerInstalled = true;
  // Seed: if we mount already-visible, treat the page as having just woken
  // so the FIRST mount after a cold start still refetches via the grace check.
  // (We don't want to silently skip the very first push-notification mount.)
  lastBecameVisibleAt = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      lastBecameVisibleAt = Date.now();
    }
  });
}

function killSwitchEngaged(): boolean {
  try {
    if (typeof window !== "undefined" && (window as any).__disableChatMountInvalidateSkip === true) {
      return true;
    }
    if (typeof localStorage !== "undefined" && localStorage.getItem("ignite_disable_chat_mount_skip") === "1") {
      return true;
    }
  } catch { /* noop */ }
  return false;
}

function realtimeConnected(): boolean {
  try {
    return !!(supabase as any)?.realtime?.isConnected?.();
  } catch {
    return false;
  }
}

/**
 * Returns true when the on-mount invalidation can be safely skipped.
 * Caller MUST still invalidate when this returns false.
 */
export function shouldSkipChatMountInvalidate(
  queryClient: QueryClient,
  queryKey: QueryKey,
  label: string,
): boolean {
  installVisibilityListener();

  if (killSwitchEngaged()) {
    console.log("[ChatMountInvalidate] ran", { label, reason: "kill-switch" });
    return false;
  }

  const state = queryClient.getQueryState(queryKey);
  if (!state || !state.dataUpdatedAt || state.data == null) {
    console.log("[ChatMountInvalidate] ran", { label, reason: "no-cached-data" });
    return false;
  }

  const ageMs = Date.now() - state.dataUpdatedAt;
  if (ageMs > FRESH_WINDOW_MS) {
    console.log("[ChatMountInvalidate] ran", { label, reason: "stale", ageMs });
    return false;
  }

  if (!realtimeConnected()) {
    console.log("[ChatMountInvalidate] ran", { label, reason: "realtime-disconnected", ageMs });
    return false;
  }

  const sinceVisibleMs = Date.now() - lastBecameVisibleAt;
  if (sinceVisibleMs < REVISIBLE_GRACE_MS) {
    console.log("[ChatMountInvalidate] ran", { label, reason: "just-became-visible", ageMs, sinceVisibleMs });
    return false;
  }

  console.log("[ChatMountInvalidate] skipped", { label, ageMs, sinceVisibleMs });
  return true;
}
