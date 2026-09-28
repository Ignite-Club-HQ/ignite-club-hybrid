import { useEffect, useRef, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";

interface Options<TMsg extends { id: string }> {
  /** Current search query from the search bar */
  searchQuery: string;
  /** Currently loaded messages */
  loadedMessages: TMsg[] | undefined;
  /** Setter to merge fetched historical matches into local state */
  setMessages: (updater: (prev: TMsg[] | undefined) => TMsg[] | undefined) => void;
  /**
   * Fetch matching messages from the DB. Should be the SAME shape the page
   * already loads (profiles, reactions, reply_to, etc.) so they render correctly.
   * Receives the trimmed query string and a `signal` for cancellation.
   */
  fetcher: (query: string, signal: AbortSignal) => Promise<TMsg[]>;
  /** Disable when missing context (e.g. before ids are ready) */
  enabled?: boolean;
  /** Min characters before searching */
  minChars?: number;
  /** Stable cache key — when this changes, last-query memo resets */
  cacheKey?: string;
}

/**
 * Fetches additional historical messages from the DB matching `searchQuery` and
 * merges them into the page's local message state. This lets chat search cover
 * the full message history (not just the messages already paginated into memory).
 *
 * The page's existing client-side `searchQuery.includes` filter then narrows
 * the merged set, and `highlightText` highlights matches in the rendered output.
 *
 * Single source of truth for empty-state gating:
 *  - `isSearching` is true while debouncing OR a request is in-flight.
 *  - `canShowEmpty` is true ONLY after the latest debounced query for the
 *    current cacheKey has fully settled (success or error). Pages must gate
 *    "No messages found" behind this flag so it never flashes prematurely.
 */
export function useChatHistorySearch<TMsg extends { id: string }>({
  searchQuery,
  loadedMessages,
  setMessages,
  fetcher,
  enabled = true,
  minChars = 2,
  cacheKey = "",
}: Options<TMsg>) {
  const debouncedQuery = useDebounce(searchQuery, 350);
  const lastQueryRef = useRef<string>("");
  const [isFetching, setIsFetching] = useState(false);
  /** memoKey of the last request that fully settled (success OR error) */
  const [settledKey, setSettledKey] = useState<string>("");
  const rawQuery = searchQuery.trim();
  const debouncedTrimmedQuery = debouncedQuery.trim();

  useEffect(() => {
    const trimmed = debouncedTrimmedQuery;
    if (!enabled || trimmed.length < minChars) {
      lastQueryRef.current = "";
      setIsFetching(false);
      // Below-threshold queries don't need server settlement — treat as
      // "settled" so callers fall back to local-only filtering immediately.
      setSettledKey(`${cacheKey}|${trimmed}|noop`);
      return;
    }

    const memoKey = `${cacheKey}|${trimmed}`;
    if (lastQueryRef.current === memoKey) {
      setIsFetching(false);
      setSettledKey(memoKey);
      return;
    }
    lastQueryRef.current = memoKey;

    const controller = new AbortController();
    setIsFetching(true);
    (async () => {
      try {
        const fetched = await fetcher(trimmed, controller.signal);
        if (controller.signal.aborted) return;

        if (fetched?.length) {
          setMessages((prev) => {
            if (!prev) return fetched;
            const existing = new Set(prev.map((m) => m.id));
            const additions = fetched.filter((m) => m.id && !existing.has(m.id));
            if (additions.length === 0) return prev;
            return [...prev, ...additions];
          });
        }
      } catch {
        // Best-effort; ignore
      } finally {
        if (!controller.signal.aborted) {
          setIsFetching(false);
          setSettledKey(memoKey);
        }
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTrimmedQuery, enabled, cacheKey]);

  const isWaitingForDebounce =
    enabled && rawQuery.length >= minChars && rawQuery !== debouncedTrimmedQuery;
  const isSearching = isWaitingForDebounce || isFetching;

  // The latest user-intended request for this cacheKey. Empty state may only
  // render once this exact key has settled and we are not mid-flight.
  const currentKey = `${cacheKey}|${debouncedTrimmedQuery}`;
  const isBelowThreshold =
    !enabled || debouncedTrimmedQuery.length < minChars;
  const latestSettled = isBelowThreshold
    ? settledKey === `${cacheKey}|${debouncedTrimmedQuery}|noop`
    : settledKey === currentKey;

  const canShowEmpty = !isSearching && latestSettled;

  return { isSearching, canShowEmpty };
}
