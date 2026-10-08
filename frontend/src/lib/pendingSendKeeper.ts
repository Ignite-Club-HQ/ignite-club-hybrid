import type { QueryClient } from "@tanstack/react-query";

/**
 * Keeps still-sending ("temp-") chat messages visible across leaving and
 * re-opening a chat. A send keeps running after the page unmounts, but the
 * refetch on return replaced the thread and dropped the optimistic bubble
 * until the slow (ICP) write finished. We remember temp rows per chat query
 * and put them back when a fetched snapshot lacks them and no real matching
 * message has arrived yet.
 */
type Row = { id: string; author_id?: string; text?: string | null; image_url?: string | null };
type Tracked = { row: Row; at: number };

const MAX_AGE_MS = 3 * 60_000;
const tracked = new Map<string, Map<string, Tracked>>();

const isTemp = (id: unknown) => typeof id === "string" && id.startsWith("temp-");
const sig = (m: Row) => `${m.author_id}::${m.text ?? ""}::${m.image_url ? "img" : ""}`;

/** Pure merge used by the keeper; exported for tests. */
export function mergePendingRows(messages: Row[], pending: Row[]): Row[] | null {
  const ids = new Set(messages.map((m) => m.id));
  const real = new Set(messages.filter((m) => !isTemp(m.id)).map(sig));
  const missing = pending.filter((p) => !ids.has(p.id) && !real.has(sig(p)));
  return missing.length ? [...messages, ...missing] : null;
}

export function installPendingSendKeeper(queryClient: QueryClient): void {
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
    if (map.size === 0) { tracked.delete(key); return; }
    if (event.action.type !== "success") return;

    const merged = mergePendingRows(messages, [...map.values()].map((t) => t.row));
    if (merged) queryClient.setQueryData(query.queryKey, { ...data, messages: merged });
  });
}
