import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Player } from "@/components/pitch/types";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const isFreshActiveGameRow = (row: { updated_at?: string | null; timer_state?: unknown } | null | undefined) => {
  if (!row?.updated_at) return false;
  const updatedAt = new Date(row.updated_at).getTime();
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > TWELVE_HOURS_MS) return false;

  const timer = (row.timer_state ?? {}) as { is_game_finished?: boolean; isGameFinished?: boolean; last_event_at?: string; lastUpdateTime?: number };
  if (timer.is_game_finished === true || timer.isGameFinished === true) return false;

  const timerUpdatedAt = typeof timer.last_event_at === "string"
    ? new Date(timer.last_event_at).getTime()
    : typeof timer.lastUpdateTime === "number"
      ? timer.lastUpdateTime
      : updatedAt;

  return Number.isFinite(timerUpdatedAt) && Date.now() - timerUpdatedAt <= TWELVE_HOURS_MS;
};

/**
 * Subscribes to the shared `active_games` row for a soccer team and surfaces
 * any **fill-in players** added by another controller (admin or Subs Manager).
 *
 * Background: the soccer pitch board hydrates each controller's state from
 * their own localStorage. When one controller adds a fill-in (e.g. an admin
 * adds "Finlay" as a fill-in for U7 White), other controllers (e.g. the
 * Subs Manager on a different device) never see that player. This hook plugs
 * that gap by reading `active_games.pitch_state.players` and returning the
 * fill-in subset, so the board can merge them in.
 *
 * Only active for controllers (`enabled=true`). Spectators have their own
 * `useCourtSpectator` / read-only paths.
 */
export function useRemoteFillInSync(teamId: string | null | undefined, enabled: boolean) {
  const [remoteFillIns, setRemoteFillIns] = useState<Player[]>([]);

  useEffect(() => {
    if (!enabled || !teamId) {
      setRemoteFillIns([]);
      return;
    }
    // Skip mini-league event-group "teams" — they sync via event_groups.
    if (teamId.startsWith("event-group-")) {
      setRemoteFillIns([]);
      return;
    }

    let cancelled = false;

    const applyRow = (row: { pitch_state: unknown; timer_state?: unknown; updated_at?: string | null } | null | undefined) => {
      if (cancelled) return;
      if (!row) {
        setRemoteFillIns([]);
        return;
      }
      if (!isFreshActiveGameRow(row)) {
        setRemoteFillIns([]);
        return;
      }
      const pitch = (row.pitch_state ?? {}) as { players?: Player[] };
      const players = Array.isArray(pitch.players) ? pitch.players : [];
      const fillIns = players.filter((p) => p && p.isFillIn && typeof p.id === "string");
      setRemoteFillIns(fillIns);
    };

    const fetchCurrent = async () => {
      const { data, error } = await supabase
        .from("active_games")
        .select("pitch_state, timer_state, updated_at")
        .eq("team_id", teamId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.warn("[RemoteFillInSync] fetch error", error);
        return;
      }
      applyRow(data);
    };

    fetchCurrent();

    const channel = supabase
      .channel(`soccer-fillins-${teamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "active_games", filter: `team_id=eq.${teamId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { pitch_state?: unknown; timer_state?: unknown; updated_at?: string | null; is_active?: boolean } | null;
          if (row && row.is_active !== false) {
            applyRow(row as { pitch_state: unknown; timer_state?: unknown; updated_at?: string | null });
          } else {
            setRemoteFillIns([]);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [teamId, enabled]);

  return remoteFillIns;
}
