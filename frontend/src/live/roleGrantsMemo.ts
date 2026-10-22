/** Dependency-free memo for caller role grants (safe to import at app start). */
const MEMO_MS = 30_000;
const memo = new Map<string, { at: number; value: Promise<unknown> }>();
export function clearRoleGrantsMemo() { memo.clear(); }
export function memoizedGrants<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value as Promise<T>;
  const value = run(); memo.set(key, { at: Date.now(), value });
  value.catch(() => { if (memo.get(key)?.value === value) memo.delete(key); });
  return value;
}
