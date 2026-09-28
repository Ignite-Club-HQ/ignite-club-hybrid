/**
 * Batch 3B — Per-surface feature flag controlling whether the on-mount
 * `invalidateQueries` effect fires on `user?.id` (eager) instead of waiting
 * for the slower `authReady` signal (which needs profile + roles + club
 * context to all hydrate, ~500–1000ms slower than the JWT being live).
 *
 * Why this is safe in principle:
 *   - The actual messages `useQuery` is already gated on `!!user?.id` and
 *     fires as soon as the JWT is on the client.
 *   - The mount-invalidate effect's only job is to force a refetch when
 *     cached data may be stale (push-notification / inbox-tap warm cache).
 *     Firing it on `user?.id` means the refetch lands during the same
 *     render pass as the first fetch, instead of triggering a SECOND fetch
 *     ~700ms later that visibly re-anchors the scroll.
 *   - Batch 3A's `shouldSkipChatMountInvalidate` still guards against
 *     redundant refetch when cache is provably fresh.
 *
 * Why this needs per-surface flags + kill switch:
 *   - Cold-start race risk: if `user?.id` is hydrated from local cache
 *     BEFORE Supabase's auth client has applied the session header, the
 *     refetch may 401 and React Query will retry (~300ms penalty — worse
 *     than waiting). The `getSession()` guard below covers the common
 *     case but isn't 100% on slow Android cold starts.
 *
 * Rollback paths (any one disables the eager gate for that surface):
 *   - localStorage['ignite_chat_eager_invalidate_<surface>'] === '0'  (per-device)
 *   - localStorage['ignite_chat_eager_invalidate_all'] === '0'        (per-device, all surfaces)
 *   - window.__disableChatEagerInvalidate === true                    (runtime, all surfaces)
 *   - Flip the per-surface DEFAULT_ENABLED entry below to `false` and redeploy.
 *
 * Rollout order (least risky first): groups → dm → broadcast → team → club.
 * Group + DM URLs carry their own ID — no dependency on the slower
 * `activeClubFilter` hydration that's part of `authReady`. Team/Club depend
 * on club context, so those stay opt-in longer.
 */

export type ChatSurface = "group" | "dm" | "team" | "club" | "broadcast";

const DEFAULT_ENABLED: Record<ChatSurface, boolean> = {
  group: true,
  dm: true,
  broadcast: true,
  team: true,
  club: true,
};

let sessionApplied: boolean | null = null;

/**
 * One-shot check that the Supabase auth session has been applied to the
 * client (so the JWT is on outgoing requests). Cached after first true.
 * Returns `true` if either the session is confirmed live OR we haven't
 * been able to probe yet (don't block the optimisation on the probe).
 */
export async function ensureSessionApplied(): Promise<boolean> {
  if (sessionApplied) return true;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    sessionApplied = !!data?.session?.access_token;
    return sessionApplied;
  } catch {
    return false;
  }
}

export function isChatEagerInvalidateEnabled(surface: ChatSurface): boolean {
  try {
    if (typeof window !== "undefined" && (window as any).__disableChatEagerInvalidate === true) {
      return false;
    }
    if (typeof localStorage !== "undefined") {
      if (localStorage.getItem("ignite_chat_eager_invalidate_all") === "0") return false;
      const perSurface = localStorage.getItem(`ignite_chat_eager_invalidate_${surface}`);
      if (perSurface === "0") return false;
      if (perSurface === "1") return true;
    }
  } catch { /* noop */ }
  return DEFAULT_ENABLED[surface];
}
