/**
 * Shared page-window trimming for chat history fetches.
 *
 * Every chat route (Team, Club, Group, Direct Message, Club Admin,
 * Broadcast) fetches `pageSize + 1` rows ordered newest-first so it can
 * detect "is there an older page?" without a second round trip, then trims
 * back to `pageSize` rows before rendering. This arithmetic is identical on
 * every route for both the initial history load and the older-history
 * ("load more") fetch; only the table, columns, and surrounding
 * entitlement/local-ICP/offline branches differ per route (see
 * docs/FRONTEND_VENDOR_HANDOVER_AUDIT.md for why those stay route-local).
 */

/**
 * Given rows fetched with a `pageSize + 1` limit, returns the rows trimmed
 * to at most `pageSize` and whether an older/further page exists.
 *
 * `pageSize` must be a positive integer; a non-positive size returns the
 * input untouched with `hasMore` false rather than throwing, so a caller
 * with a misconfigured constant fails safe instead of dropping all rows.
 *
 * `T` defaults to `any` (not left to bare inference) because every current
 * call site passes an un-generic-parameterized Supabase query result typed
 * `any`. Without the default, TypeScript's generic inference collapses an
 * `any`-typed argument to `T = unknown`, which would erase every field's
 * type at the call site and manufacture new "Property does not exist on
 * type unknown" diagnostics that do not reflect a real behavior or type
 * change. Callers with a genuinely typed array still get that type back
 * (the default only applies when inference has nothing concrete to work
 * from), so this does not hide a future narrowing of the Supabase result
 * type — it only keeps this helper as type-neutral as the code it replaces.
 */
export function splitPageWindow<T = any>(
  rows: readonly T[],
  pageSize: number,
): { items: T[]; hasMore: boolean } {
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return { items: [...rows], hasMore: false };
  }
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : [...rows];
  return { items, hasMore };
}
