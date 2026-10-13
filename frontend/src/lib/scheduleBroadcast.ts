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
    // RLS would reject the insert outright. Fan out a notification to every
    // role-grant principal on the club/team instead of writing a
    // schedule_broadcasts row.
    if (resolveAuthBackend() === "icp") {
      return sendScheduleBroadcastIcp(clubId, teamId ?? null);
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

/**
 * Internet Identity branch: fans out a schedule-refresh notification to the
 * unique set of role-grant principals for the club (or just the team, when
 * scoped). All ICP modules load lazily so the agent/candid SDK never lands
 * in a Supabase account's entry chunk.
 */
async function sendScheduleBroadcastIcp(
  clubId: string,
  teamId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const [{ getCurrentInternetIdentity }, { getActiveIcpTarget }, membership, notifications] =
      await Promise.all([
        import("@/live/internetIdentityAuth"),
        import("@/live/targetRegistry"),
        import("@/live/features/membership"),
        import("@/live/features/notifications"),
      ]);
    const identity = await getCurrentInternetIdentity();
    if (!identity) return { ok: false, error: "Internet Identity session required" };
    const ctx = { identity, target: getActiveIcpTarget() };

    const grants = teamId
      ? await membership.listLiveTeamRoleGrants(ctx, teamId)
      : await membership.listLiveRoleGrants(ctx, clubId);
    const opt = (v: unknown): string | null => (Array.isArray(v) ? (v[0] as string) ?? null : (v as string | null));
    const userIds = [
      ...new Set(
        (grants as Array<{ user: { toText: () => string }; team?: unknown }>)
          .filter((g) => !teamId || opt(g.team) === teamId)
          .map((g) => g.user.toText()),
      ),
    ];
    if (userIds.length === 0) return { ok: true };

    await notifications.fanOutLiveNotifications(ctx, {
      userIds,
      clubId,
      kind: "schedule_refresh",
      body: "The schedule has been updated.",
      idempotencyKeyPrefix: `schedule-broadcast-${clubId}-${teamId ?? "club"}-${Date.now()}`,
      relatedId: teamId,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}
