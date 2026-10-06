// Saves successful React Query results to localStorage so pages open instantly
// on the next app launch (then refresh in the background). Key uses the
// `ignite_` prefix so clearUserScopedCaches() wipes it on sign-out / account
// switch. Only JSON-safe data is persisted: results containing Dates, BigInts,
// Maps, Uint8Arrays, blob: URLs or other non-plain values are skipped so a
// restored value is always identical in shape to a fresh one.
import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

export const QUERY_CACHE_KEY = "ignite_query_cache_v1";
const MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_ENTRY_CHARS = 150_000;
const MAX_TOTAL_CHARS = 2_500_000;

function safeStringify(value: unknown): string | null {
  let ok = true;
  try {
    const s = JSON.stringify(value, function (key, v) {
      const raw = (this as any)[key];
      if (
        raw instanceof Date || typeof v === "bigint" || raw instanceof Map || raw instanceof Set ||
        ArrayBuffer.isView(raw) || raw instanceof ArrayBuffer || typeof v === "function" ||
        (typeof v === "string" && v.startsWith("blob:")) ||
        (raw && typeof raw === "object" && !Array.isArray(raw) &&
          Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)
      ) ok = false;
      return v;
    });
    return ok && s !== undefined ? s : null;
  } catch {
    return null;
  }
}

export function restoreQueryCache(client: QueryClient) {
  try {
    const raw = localStorage.getItem(QUERY_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(QUERY_CACHE_KEY);
      return;
    }
    hydrate(client, parsed.state);
  } catch {
    localStorage.removeItem(QUERY_CACHE_KEY);
  }
}

export function startQueryCachePersistence(client: QueryClient) {
  let timer: number | undefined;
  const save = () => {
    timer = undefined;
    try {
      const state = dehydrate(client, {
        shouldDehydrateQuery: (q) => q.state.status === "success" && q.meta?.persist !== false,
      });
      let total = 0;
      const queries = state.queries
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
        .filter((q) => {
          const s = safeStringify(q.state.data);
          if (!s || s.length > MAX_ENTRY_CHARS || total + s.length > MAX_TOTAL_CHARS) return false;
          total += s.length;
          return true;
        });
      if (!queries.length) {
        localStorage.removeItem(QUERY_CACHE_KEY);
        return;
      }
      localStorage.setItem(
        QUERY_CACHE_KEY,
        JSON.stringify({ savedAt: Date.now(), state: { mutations: [], queries } }),
      );
    } catch {
      try { localStorage.removeItem(QUERY_CACHE_KEY); } catch { /* ignore */ }
    }
  };
  client.getQueryCache().subscribe(() => {
    if (timer === undefined) timer = window.setTimeout(save, 2000);
  });
  window.addEventListener("pagehide", save);
}
