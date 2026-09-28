import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useFreeClubPollingEnabled } from "@/hooks/useFreeClubPollingEnabled";

export type ClubRealtimeMode = "realtime" | "polling";

/**
 * Polling interval used for Free-tier clubs when the admin flag is ON.
 * Kept intentionally moderate (30s) so message delay stays acceptable while
 * still cutting WebSocket load by an order of magnitude vs. always-on
 * realtime channels.
 */
export const FREE_CLUB_POLL_INTERVAL_MS = 30_000;

/**
 * Decides whether a given club's chat should use Supabase Realtime or fall
 * back to periodic polling. Polling is ONLY applied when:
 *   1. The app-admin flag `free_club_polling_enabled` is ON, and
 *   2. The club is resolved and does NOT have Pro access.
 *
 * Defaults to "realtime" while Pro status is loading, when clubId is null,
 * or when the flag is off — so a transient unknown never silently downgrades
 * a Pro club's real-time experience.
 */
export function useClubRealtimeMode(clubId: string | null | undefined): {
  mode: ClubRealtimeMode;
  intervalMs: number;
} {
  const pollingFlagOn = useFreeClubPollingEnabled();
  const { hasPro, isLoading } = useClubProAccess(clubId ?? null);

  const shouldPoll =
    pollingFlagOn && !!clubId && !isLoading && !hasPro;

  return {
    mode: shouldPoll ? "polling" : "realtime",
    intervalMs: FREE_CLUB_POLL_INTERVAL_MS,
  };
}
