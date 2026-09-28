import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { abortAllInFlightRestGets } from "@/lib/supabaseAuthRetry";

/**
 * Shared escape hatch for chat pages that come back from a long Android
 * background stint stuck on `ChatPageSkeleton`.
 *
 * Why this exists
 * ---------------
 * A PostgREST GET that was in flight when the WebView was frozen never fails
 * on its own (its `setTimeout` abort is frozen too). Any query gated on it —
 * the messages query, or worse the *metadata* query that decides whether the
 * page renders at all (`club-subscription`, `group`, `dm-conversation`,
 * `club-admin-conversation`) — stays pending forever, so the page shows a
 * skeleton until a force-quit.
 *
 * Team chat did not exhibit this because it (a) renders its header from
 * `clubTeamCache` so the metadata gate resolves offline, and (b) puts a hard
 * 15s abort budget inside its messages `queryFn`. Every other chat page had
 * neither. This hook gives them the same recovery as Schedule/Media: while
 * stuck, abort the zombie sockets and re-issue the gating queries, repeating
 * every 6s (a single one-shot kick can itself queue behind a dead socket).
 */
export function useChatStuckWatchdog(
  stuck: boolean,
  queryKeys: QueryKey[],
  label: string,
): void {
  const queryClient = useQueryClient();
  const keysSignature = JSON.stringify(queryKeys);

  useEffect(() => {
    if (!stuck) return;
    const keys: QueryKey[] = JSON.parse(keysSignature);
    const kick = () => {
      const aborted = abortAllInFlightRestGets(`${label}-watchdog`);
      console.warn("[ChatWatchdog] kick", { label, abortedInFlight: aborted });
      for (const key of keys) {
        queryClient.refetchQueries({ queryKey: key });
      }
    };
    const timer = setInterval(kick, 6000);
    return () => clearInterval(timer);
  }, [stuck, keysSignature, label, queryClient]);
}

/**
 * Hard wall-clock budget for a chat `queryFn`, mirroring TeamChatPage.
 * Returns a signal to attach via `.abortSignal()` plus a `done()` cleanup that
 * MUST be called on every exit path (success and throw).
 */
export function createChatFetchBudget(ms = 15_000): {
  signal: AbortSignal;
  done: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
  };
}
