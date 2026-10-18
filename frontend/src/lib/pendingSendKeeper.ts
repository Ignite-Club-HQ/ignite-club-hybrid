import type { QueryClient } from "@tanstack/react-query";

/**
 * Keeps still-sending ("temp-") chat messages visible across leaving and
 * re-opening a chat. A send keeps running after the page unmounts, but the
 * refetch on return replaced the thread and dropped the optimistic bubble
 * until the slow (ICP) write finished. We remember temp rows per chat query
 * and put them back when a fetched snapshot lacks them and no real matching
 * message has arrived yet.
 */
type Row = { id: string; author_id?: string; text?: string | null; image_url?: string | null; optimistic_id?: string };
type Tracked = { row: Row; at: number };

const MAX_AGE_MS = 3 * 60_000;

const isTemp = (id: unknown) => typeof id === "string" && id.startsWith("temp-");
const sig = (m: Row) => `${m.author_id}::${(m.text ?? "").trim()}::${m.image_url ?? ""}`;

const keepers = new WeakMap<QueryClient, Map<string, Map<string, Tracked>>>();

/** Settle exactly this send from the server acknowledgement, even after unmount. */
export function confirmPendingSend(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  tempId: string,
  saved: { id: string; text: string; image_url: string | null; created_at: string },
): void {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (query) keepers.get(queryClient)?.get(query.queryHash)?.delete(tempId);
  queryClient.setQueryData(queryKey, (old: { messages: Row[] } | undefined) => {
    if (!old) return old;
    const preview = old.messages.find((row) => row.id === tempId);
    const messages = old.messages.filter((row) => row.id !== tempId);
    const existing = messages.findIndex((row) => row.id === saved.id);
    if (existing >= 0) messages[existing] = { ...messages[existing], optimistic_id: tempId };
    else if (preview) messages.push({ ...preview, ...saved, optimistic_id: tempId });
    return { ...old, messages };
  });
}

/** Pure merge used by the keeper; exported for tests. */
export function mergePendingRows(messages: Row[], pending: Row[]): Row[] | null {
  const ids = new Set(messages.map((m) => m.id));
  const real = new Set(messages.filter((m) => !isTemp(m.id)).map(sig));
  // A refetch can restore a preview just before the saved row arrives.
  // Clean previews already IN the snapshot, not only those we might append.
  const confirmedOnly = messages.filter((m) => !isTemp(m.id) || !real.has(sig(m)));
  const missing = pending.filter((p) => !ids.has(p.id) && !real.has(sig(p)));
  return missing.length || confirmedOnly.length !== messages.length
    ? [...confirmedOnly, ...missing]
    : null;
}

export function installPendingSendKeeper(queryClient: QueryClient): void {
  if (keepers.has(queryClient)) return;
  const tracked = new Map<string, Map<string, Tracked>>();
  keepers.set(queryClient, tracked);
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const query = event.query;
    const data = query.state.data as { messages?: Row[] } | undefined;
    if (!data || !Array.isArray(data.messages)) return;
    const key = query.queryHash;
    const now = Date.now();
    let map = tracked.get(key);
    const messages = data.messages;
    const present = new Set(messages.map((m) => m.id));
    const realSigs = new Set(messages.filter((m) => !isTemp(m.id)).map(sig));

    for (const m of messages) {
      if (!isTemp(m.id)) continue;
      if (!map) tracked.set(key, (map = new Map()));
      if (!map.has(m.id)) map.set(m.id, { row: m, at: now });
    }
    if (!map) return;

    for (const [id, t] of map) {
      if (now - t.at > MAX_AGE_MS || realSigs.has(sig(t.row))) map.delete(id);
      // A local edit (failed send rollback) removed it on purpose.
      else if (!present.has(id) && event.action.type !== "success") map.delete(id);
    }
    if (map.size === 0) tracked.delete(key);
    if (event.action.type !== "success") return;

    const merged = mergePendingRows(messages, [...map.values()].map((t) => t.row));
    if (merged) queryClient.setQueryData(query.queryKey, { ...data, messages: merged });
  });
}
