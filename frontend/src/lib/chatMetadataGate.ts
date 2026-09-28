/**
 * Shared decision logic for "is this chat actually gone, or did the network
 * just blink?".
 *
 * Why this exists
 * ---------------
 * Chat pages fetched their metadata row with `.single()` and threw on any
 * error, then rendered a hard "This chat group has been removed / not found"
 * screen whenever `data` was falsy. React Query surfaces BOTH of these as
 * `data === undefined`:
 *
 *   - the row genuinely does not exist (or RLS hides it), and
 *   - the request failed — dropped connection, aborted zombie socket,
 *     paused-while-offline, 5xx.
 *
 * On a flaky mobile connection (notification tap while coverage drops) the
 * second case rendered the first case's copy, telling users a live group had
 * been deleted. That is a false negative with no recovery path other than
 * force-quitting the app.
 *
 * `resolveChatMetadataState` separates them. Only a query that completed
 * successfully AND returned no row may be reported as `missing`; anything
 * that errored, paused, or is running while offline is `unreachable` and gets
 * a retry affordance instead of a deletion claim.
 */

export type ChatMetadataState = "loading" | "unreachable" | "missing" | "ready";

export interface ChatMetadataQueryLike {
  /** The fetched row. `null`/`undefined` means "no row in hand". */
  data: unknown;
  /** React Query `isLoading` (no data AND fetching for the first time). */
  isLoading: boolean;
  /** React Query `isError`. */
  isError: boolean;
  /** React Query `fetchStatus`: "fetching" | "paused" | "idle". */
  fetchStatus: "fetching" | "paused" | "idle";
  /** React Query `status`. Used to prove the query actually succeeded. */
  status?: "pending" | "success" | "error" | "loading";
  /** Browser/native connectivity. Defaults to online when unknown. */
  isOnline?: boolean;
}

export function resolveChatMetadataState({
  data,
  isLoading,
  isError,
  fetchStatus,
  status,
  isOnline = true,
}: ChatMetadataQueryLike): ChatMetadataState {
  // Cached or freshly fetched row wins over everything — never block a chat
  // that we can already render.
  if (data) return "ready";

  // Hard failure, or paused because React Query knows we're offline.
  if (isError) return "unreachable";
  if (fetchStatus === "paused") return "unreachable";

  // Still in flight (or about to be) — keep the skeleton.
  if (isLoading || fetchStatus === "fetching") return "loading";

  // Settled with no row while offline: we cannot distinguish "deleted" from
  // "never reached the server", so fail safe to unreachable.
  if (!isOnline) return "unreachable";

  // Only a proven-successful query may claim the chat is gone.
  if (status === "success") return "missing";

  // Idle + not success + online (e.g. query disabled, or an aborted fetch that
  // never resolved). Treat as recoverable rather than deleted.
  return "unreachable";
}
