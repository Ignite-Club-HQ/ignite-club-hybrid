/**
 * Shared classification for "is this chat thread actually empty, or is it
 * still recovering?".
 *
 * Background (Club Admin blank-thread defect)
 * -------------------------------------------
 * After Android resume, React Query can hold a query in
 * `status: "pending"` + `fetchStatus: "paused"` while Capacitor settles
 * connectivity. In that state `isLoading` is FALSE and `data` is
 * `undefined`. A page that only reads `data`/`isLoading` therefore concludes
 * "loaded, zero messages" and renders an empty scroller — a blank thread.
 *
 * This module is pure so it can be unit tested without React.
 */

export type ChatThreadPhase = "loading" | "error" | "empty" | "content";

export interface ChatThreadStateInput {
  /** Auth/RLS context ready (session restored). */
  authReady: boolean;
  /** React Query `status`. */
  status: "pending" | "success" | "error";
  /** React Query `fetchStatus`. */
  fetchStatus: "fetching" | "paused" | "idle";
  /** React Query `isError`. */
  isError: boolean;
  /** Usable cached/local content is already renderable. */
  hasUsableCached: boolean;
  /**
   * Number of messages in the authoritative response, or `null` when the
   * query has never produced data.
   */
  fetchedCount: number | null;
  /** The inbox already proves a message exists in this conversation. */
  inboxSaysHasMessage: boolean;
  /** Bounded automatic recovery attempts have all been used. */
  recoveryExhausted: boolean;
}

/**
 * Decide what a chat thread should render. Cached content always wins over a
 * spinner; a transient empty response never renders the "legitimately empty"
 * state while recovery is still possible.
 */
export function classifyChatThreadState(input: ChatThreadStateInput): ChatThreadPhase {
  const {
    authReady,
    status,
    fetchStatus,
    isError,
    hasUsableCached,
    fetchedCount,
    inboxSaysHasMessage,
    recoveryExhausted,
  } = input;

  if (fetchedCount !== null && fetchedCount > 0) return "content";
  if (hasUsableCached) return "content";

  // No renderable content from here on.
  if (isError || status === "error") {
    return recoveryExhausted ? "error" : "loading";
  }
  if (!authReady) return "loading";
  if (status === "pending" || fetchStatus === "paused" || fetchStatus === "fetching") {
    return "loading";
  }

  // Authoritative-looking empty response.
  if (fetchedCount === 0) {
    // The inbox proves a message exists — the empty body is inconsistent.
    if (inboxSaysHasMessage) return recoveryExhausted ? "error" : "loading";
    return recoveryExhausted || status === "success" ? "empty" : "loading";
  }

  return "loading";
}

/** Bounded backoff for recovering an inconsistent/empty thread response. */
export const EMPTY_RETRY_DELAYS_MS = [400, 1200, 3000] as const;

/** Delay for the given zero-based attempt, or `null` when exhausted. */
export function nextEmptyRetryDelay(attempt: number): number | null {
  if (attempt < 0 || attempt >= EMPTY_RETRY_DELAYS_MS.length) return null;
  return EMPTY_RETRY_DELAYS_MS[attempt];
}

/** Marker written by the push-notification preload path. */
export const NOTIFICATION_PRELOAD_FLAG = "__notification_preload";

/**
 * A cached thread is usable as temporary fallback content when it has at
 * least one message that did NOT come from a notification-only preload.
 * A genuine one-message conversation is therefore preserved (previously the
 * blanket `length >= 2` guard discarded it).
 */
export function isUsableCachedThread(
  messages: ReadonlyArray<Record<string, unknown>> | null | undefined,
): boolean {
  if (!messages || messages.length === 0) return false;
  return messages.some((m) => m?.[NOTIFICATION_PRELOAD_FLAG] !== true);
}
