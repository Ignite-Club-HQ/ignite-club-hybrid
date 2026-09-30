import { supabase } from "@/integrations/supabase/client";
import { ensureFreshSession } from "@/lib/ensureFreshSession";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

/**
 * Server-side schedule refresh broadcast.
 *
 * Admins insert a row into `schedule_broadcasts` (scoped to a club, optionally
 * a single team). All connected clients subscribe to the table via Realtime
 * and invalidate their cached events when a new row arrives — so every
 * member's schedule view re-fetches without needing to pull-to-refresh.
 *
 * RLS enforces who can insert (club_admin / app_admin / league_admin / team
 * admin or coach for the given team).
 */

export async function sendScheduleBroadcast(
  clubId: string,
  teamId?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Internet Identity sessions are canister-authenticated — there is no
    // Supabase session to refresh or to attribute this row to, and Supabase
    // RLS would reject the insert outright. Subscribers on the ICP path
    // already poll for updates (see subscribeToScheduleBroadcasts below), so
    // there's nothing to bump here.
    if (resolveAuthBackend() === "icp") {
      return { ok: true };
    }
    const userId = await ensureFreshSession();
    const { error } = await supabase.from("schedule_broadcasts").insert({
      club_id: clubId,
      team_id: teamId ?? null,
      bumped_by: userId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

/**
 * Subscribe to schedule broadcasts for a set of clubs. Calls `onBump` whenever
 * a new row arrives matching one of the clubIds. Returns an unsubscribe fn.
 */
export function subscribeToScheduleBroadcasts(
  clubIds: string[],
  onBump: (row: { club_id: string; team_id: string | null }) => void,
): () => void {
  if (clubIds.length === 0) return () => {};

  // When events are routed to ICP, canisters are request/response — there is
  // no realtime channel to subscribe to, and no one will ever insert a
  // schedule_broadcasts row (see sendScheduleBroadcast above). Poll instead,
  // same Stage-D pattern as startChatRealtimeChannel / useClubRealtimeMode.
  if (isFeatureRoutedToIcp("events")) {
    const poll = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      onBump({ club_id: clubIds[0], team_id: null });
    }, 30000);
    return () => clearInterval(poll);
  }

  const channel = supabase
    .channel(`schedule-broadcasts:${clubIds.sort().join(",")}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "schedule_broadcasts",
      },
      (payload) => {
        const row = payload.new as { club_id: string; team_id: string | null };
        if (clubIds.includes(row.club_id)) onBump(row);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
