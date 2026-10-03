import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useFreeClubPollingEnabled } from "@/hooks/useFreeClubPollingEnabled";
import { useIsDocumentVisible } from "@/hooks/useIsDocumentVisible";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

export type ClubRealtimeMode = "realtime" | "polling";

/**
 * Polling interval used for Free-tier/ICP clubs while the chat screen's tab
 * is visible — fast enough to feel live without hammering the canister.
 */
export const CHAT_POLL_INTERVAL_VISIBLE_MS = 10_000;

/**
 * Polling interval used for Free-tier/ICP clubs while the tab is hidden —
 * slowed way down since there's no one watching; an immediate invalidation
 * fires on visibility regain to catch up instantly.
 */
export const CHAT_POLL_INTERVAL_HIDDEN_MS = 60_000;

/**
 * @deprecated kept for backwards compatibility with existing call sites/tests
 * that expect a single constant; equals the visible-tab interval.
 */
export const FREE_CLUB_POLL_INTERVAL_MS = CHAT_POLL_INTERVAL_VISIBLE_MS;

/**
 * Decides whether a given club's chat should use Supabase Realtime or fall
 * back to periodic polling. Polling is applied when EITHER:
 *   1. Messaging is routed to ICP — canisters are request/response, so there
 *      is no realtime channel to subscribe to (ICP-only cutover Stage D), or
 *   2. The app-admin flag `free_club_polling_enabled` is ON and the club is
 *      resolved and does NOT have Pro access.
 *
 * Defaults to "realtime" while Pro status is loading, when clubId is null,
 * or when the flag is off — so a transient unknown never silently downgrades
 * a Pro club's real-time experience.
 *
 * The returned `intervalMs` is visibility-aware: faster while the tab is
 * visible/focused, slower while it's hidden, so backgrounded tabs don't keep
 * hammering the canister/DB.
 */
export function useClubRealtimeMode(clubId: string | null | undefined): {
  mode: ClubRealtimeMode;
  intervalMs: number;
} {
  const pollingFlagOn = useFreeClubPollingEnabled();
  const { hasPro, isLoading } = useClubProAccess(clubId ?? null);
  const isDocumentVisible = useIsDocumentVisible();

  const messagingOnIcp = isFeatureRoutedToIcp("messaging");
  const shouldPoll =
    messagingOnIcp ||
    (pollingFlagOn && !!clubId && !isLoading && !hasPro);

  return {
    mode: shouldPoll ? "polling" : "realtime",
    intervalMs: isDocumentVisible ? CHAT_POLL_INTERVAL_VISIBLE_MS : CHAT_POLL_INTERVAL_HIDDEN_MS,
  };
}
