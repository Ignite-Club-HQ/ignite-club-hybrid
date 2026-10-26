import { useRef } from "react";
import { useLocation } from "react-router-dom";
import { useKeptPageActive } from "@/components/layout/KeptPageActivity";

/** Keep placement, not stale data or access: missing rows disappear immediately. */
export function reconcileVisibleList<T>(next: readonly T[], previous: readonly T[], key: (row: T) => string,
  merge: (old: T, fresh: T) => T = (_old, fresh) => fresh): T[] {
  const remaining = new Map(next.map(row => [key(row), row]));
  const rows: T[] = [];
  for (const old of previous) {
    const id = key(old);
    const fresh = remaining.get(id);
    if (fresh === undefined) continue;
    rows.push(merge(old, fresh));
    remaining.delete(id);
  }
  return [...rows, ...remaining.values()];
}

export function useStableVisibleList<T>(next: readonly T[], options: {
  enabled: boolean; scope: string; key: (row: T) => string;
  merge?: (old: T, fresh: T) => T;
}): T[] {
  const active = useKeptPageActive();
  const location = useLocation();
  // Kept pages reset while hidden; ordinary pages reset on a new history entry.
  const scope = JSON.stringify([options.scope, active === null ? location.key : null]);
  const state = useRef<{ scope: string; rows: T[] }>({ scope, rows: [] });
  const reset = !options.enabled || active === false || state.current.scope !== scope;
  const rows = reset ? [...next] : reconcileVisibleList(next, state.current.rows, options.key, options.merge);
  state.current = { scope, rows };
  return rows;
}