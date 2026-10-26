/** Display discovery only: destinations still authorize every content operation. */
import type { QueryClient } from '@tanstack/react-query';
import { withReadDeadline } from './readDeadline';
export const MEMBERSHIP_RECONCILE_MS = 15 * 60 * 1000;
type Entry = { value?: unknown; checkedAt: number; pending?: Promise<unknown>; load: () => Promise<unknown> };
const entries = new Map<string, Entry>();
let generation = 0;
let teardown: (() => void) | undefined;
let client: QueryClient | undefined;
const MEMBER_QUERY_PREFIXES = ['clubs', 'user-memberships-and-events', 'user-memberships-for-events', 'user-clubs-for-filter',
  'member-clubs-with-messages', 'my-teams-with-messages', 'my-chat-groups-with-messages', 'my-teams-premium-v2',
  'user-roles', 'icp-media-feed', 'user-clubs-for-upgrade', 'removed-clubs', 'icp-my-mini-leagues', 'icp-schedule-fixtures', 'events'];
const cacheKey = (key: string) => ['icp-membership-discovery', key];
const fingerprint = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v);
export function bindMembershipDiscovery(client0: QueryClient): void { client = client0; }

function reconcile(key: string, entry: Entry): Promise<unknown> {
  if (entry.pending) return entry.pending;
  const captured = generation;
  const pending = withReadDeadline(Promise.resolve().then(entry.load), 'Membership discovery', 60_000).then(value => {
    if (entry.pending !== pending) throw new Error('Membership discovery changed');
    if (captured !== generation || entries.get(key) !== entry) throw new Error('Membership discovery changed');
    const changed = entry.value !== undefined && fingerprint(entry.value) !== fingerprint(value);
    entry.value = value;
    entry.checkedAt = Date.now();
    client?.setQueryData(cacheKey(key), { value, checkedAt: entry.checkedAt });
    if (changed) for (const prefix of MEMBER_QUERY_PREFIXES) void client?.invalidateQueries({ queryKey: [prefix] });
    return value;
  }).finally(() => { if (entry.pending === pending) entry.pending = undefined; });
  entry.pending = pending;
  return pending;
}

export function reconcileMembershipDiscovery(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  for (const [key, entry] of entries) {
    if (Date.now() - entry.checkedAt >= MEMBERSHIP_RECONCILE_MS) void reconcile(key, entry).catch(() => undefined);
  }
}

function watchForeground() {
  if (teardown || typeof window === 'undefined') return;
  let timer: ReturnType<typeof setInterval> | undefined;
  const update = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (document.visibilityState !== 'hidden') {
      reconcileMembershipDiscovery();
      timer = setInterval(reconcileMembershipDiscovery, MEMBERSHIP_RECONCILE_MS);
    }
  };
  window.addEventListener('online', update);
  document.addEventListener('visibilitychange', update);
  // Do not synchronously reconcile while registering the first entry.
  if (document.visibilityState !== 'hidden') timer = setInterval(reconcileMembershipDiscovery, MEMBERSHIP_RECONCILE_MS);
  teardown = () => {
    if (timer) clearInterval(timer);
    window.removeEventListener('online', update);
    document.removeEventListener('visibilitychange', update);
  };
}

export async function readMembershipDiscovery<T>(key: string, load: () => Promise<T>): Promise<T> {
  let entry = entries.get(key);
  if (!entry) {
    const saved = client?.getQueryData<{ value: unknown; checkedAt: number }>(cacheKey(key));
    entry = { checkedAt: saved?.checkedAt ?? 0, value: saved?.value, load };
    entries.set(key, entry);
  } else entry.load = load;
  watchForeground();
  if (entry.value !== undefined) {
    // Content callers never wait for an overdue background reconciliation.
    if (Date.now() - entry.checkedAt >= MEMBERSHIP_RECONCILE_MS) reconcileMembershipDiscovery();
    return entry.value as T;
  }
  return await reconcile(key, entry) as T;
}

export function clearMembershipDiscovery(): void {
  generation++;
  entries.clear();
  client?.removeQueries({ queryKey: ['icp-membership-discovery'] });
  teardown?.();
  teardown = undefined;
}

/** An acknowledged local mutation invalidates display inventories, not authority. */
export function invalidateMembershipDisplays(): void {
  clearMembershipDiscovery();
  for (const prefix of MEMBER_QUERY_PREFIXES) void client?.invalidateQueries({ queryKey: [prefix] });
}