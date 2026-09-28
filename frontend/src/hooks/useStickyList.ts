import { useEffect, useRef } from "react";

/**
 * Keeps the last known non-empty list visible while a query is in flight,
 * has errored, or has not settled yet.
 *
 * Why: on native resume (and on reconnect) an inbox source query can briefly
 * resolve to `undefined`/`[]` — auth token refresh, RLS settling, a dropped
 * socket — which made rows vanish from the Messages inbox for a beat before
 * the real data landed. A genuinely empty result is still honoured: once the
 * query has settled successfully (fetched, not fetching, no error) an empty
 * array is authoritative and the sticky value is released, so deleted /
 * removed conversations do NOT linger forever.
 *
 * Identity is preserved between renders when nothing changes, so downstream
 * `useMemo` chains do not recompute.
 */
export function useStickyList<T>(
  list: T[] | undefined | null,
  opts: {
    /** Query is currently fetching (initial load or background refetch). */
    isFetching?: boolean;
    /** Query has completed at least once for this key. */
    isFetched?: boolean;
    /** Query is in an error state — an empty result carries no authority. */
    isError?: boolean;
    /** Changing this (e.g. user id) drops the retained value. */
    resetKey?: string | number | null;
  } = {},
): T[] {
  const { isFetching = false, isFetched = true, isError = false, resetKey = null } = opts;

  const stickyRef = useRef<T[] | null>(null);
  const resetKeyRef = useRef(resetKey);

  if (resetKeyRef.current !== resetKey) {
    resetKeyRef.current = resetKey;
    stickyRef.current = null;
  }

  const current = list ?? null;

  if (current && current.length > 0) {
    stickyRef.current = current;
    return current;
  }

  // Empty or missing result.
  const settledEmpty = !!current && current.length === 0 && isFetched && !isFetching && !isError;
  if (settledEmpty) {
    stickyRef.current = null;
    return current;
  }

  if (stickyRef.current) return stickyRef.current;
  return current ?? EMPTY;
}

const EMPTY: never[] = [];

/**
 * Test/diagnostic helper: mirrors the decision the hook makes, without React.
 */
export function resolveStickyList<T>(
  list: T[] | undefined | null,
  retained: T[] | null,
  opts: { isFetching?: boolean; isFetched?: boolean; isError?: boolean } = {},
): { value: T[]; retained: T[] | null } {
  const { isFetching = false, isFetched = true, isError = false } = opts;
  const current = list ?? null;
  if (current && current.length > 0) return { value: current, retained: current };
  const settledEmpty = !!current && current.length === 0 && isFetched && !isFetching && !isError;
  if (settledEmpty) return { value: current, retained: null };
  if (retained) return { value: retained, retained };
  return { value: current ?? [], retained };
}

/** Small convenience: run a callback when the retained value is dropped. */
export function useStickyListReset(resetKey: string | number | null, onReset: () => void) {
  const prev = useRef(resetKey);
  useEffect(() => {
    if (prev.current !== resetKey) {
      prev.current = resetKey;
      onReset();
    }
  }, [resetKey, onReset]);
}
