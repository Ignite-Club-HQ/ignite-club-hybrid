export interface InboxDisplayListInput<T> {
  sticky: readonly T[] | null | undefined;
  cached: readonly T[] | null | undefined;
  isOnline: boolean;
  isFetched: boolean;
}

/**
 * Selects the visible inbox rows after `useStickyList` has interpreted query
 * lifecycle state. A settled online empty array is authoritative; cache is
 * only a first-load/offline fallback or a last resort when no sticky snapshot
 * exists at all.
 */
export function resolveInboxDisplayList<T>({
  sticky,
  cached,
  isOnline,
  isFetched,
}: InboxDisplayListInput<T>): readonly T[] {
  if (sticky?.length) return sticky;
  if ((!isOnline || !isFetched) && cached) return cached;
  return sticky ?? cached ?? [];
}
