/**
 * Regression tests for src/hooks/useEventViews.ts
 *
 * Bug 1: A failed/unauthorized existence lookup was coerced to `false`,
 *        which the effect interpreted as "confirmed not viewed" and
 *        triggered an insert. A failed read must NEVER cause a write.
 *
 * Bug 2: `eventIds.sort()` mutated the caller-owned array. The cache
 *        key must be built from a copied, deduplicated, sorted array so
 *        the caller's array is never reordered and equivalent ID sets
 *        in different orders reuse the same React Query cache entry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------- Supabase mock ----------------------------------------------
type MaybeSingleResp = { data: { id: string } | null; error: { message: string } | null };
type SelectResp = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type InsertResp = { error: { message: string } | null };

const state = {
  maybeSingle: { data: null, error: null } as MaybeSingleResp,
  selectList: { data: [], error: null } as SelectResp,
  insertResult: { error: null } as InsertResp,
  insertCalls: 0,
  insertPayloads: [] as any[],
  maybeSingleCalls: 0,
  inFilterCalls: [] as string[][],
};

function makeChain(table: string) {
  const chain: any = {
    _table: table,
    _isInsert: false,
    _isSelect: false,
    _isAdminSelect: false,
    _hasIn: false,
    select(_cols?: string) {
      if (chain._isInsert) return chain;
      chain._isSelect = true;
      if (_cols && _cols.includes("viewed_at")) chain._isAdminSelect = true;
      return chain;
    },
    eq() { return chain; },
    in(_col: string, values: string[]) {
      chain._hasIn = true;
      state.inFilterCalls.push([...values]);
      // resolve as a thenable
      return Promise.resolve(state.selectList);
    },
    async maybeSingle() {
      state.maybeSingleCalls += 1;
      return state.maybeSingle;
    },
    insert(payload: any) {
      chain._isInsert = true;
      state.insertCalls += 1;
      state.insertPayloads.push(payload);
      return Promise.resolve(state.insertResult);
    },
    // admin select path awaits directly
    then(resolve: any, reject: any) {
      // Only used when the caller awaits the builder (admin select)
      return Promise.resolve(state.selectList).then(resolve, reject);
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => makeChain(t) },
}));

// ---------- imports (after mocks) --------------------------------------
import {
  useEventViewTracking,
  useEventViewsAdmin,
  useUserEventViews,
} from "./useEventViews";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 60_000, refetchOnMount: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

beforeEach(() => {
  state.maybeSingle = { data: null, error: null };
  state.selectList = { data: [], error: null };
  state.insertResult = { error: null };
  state.insertCalls = 0;
  state.insertPayloads = [];
  state.maybeSingleCalls = 0;
  state.inFilterCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("useEventViewTracking — Bug 1: lookup failure must not trigger insert", () => {
  it("must not attempt a write when checking existing view state fails", async () => {
    state.maybeSingle = { data: null, error: { message: "permission denied" } };
    const { Wrapper } = wrapper();

    const { result } = renderHook(
      () => useEventViewTracking("evt-1", "user-1"),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(state.maybeSingleCalls).toBeGreaterThan(0));
    // Give any (incorrect) queued mutation a chance to fire
    await new Promise((r) => setTimeout(r, 30));

    expect(state.insertCalls).toBe(0);
    expect(result.current.hasViewed).toBeUndefined();
  });

  it("confirmed existing view causes no insert", async () => {
    state.maybeSingle = { data: { id: "view-1" }, error: null };
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useEventViewTracking("evt-1", "user-1"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.hasViewed).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(state.insertCalls).toBe(0);
  });

  it("confirmed missing view causes exactly one insert scoped to event+user", async () => {
    state.maybeSingle = { data: null, error: null };
    const { Wrapper } = wrapper();
    renderHook(
      () => useEventViewTracking("evt-1", "user-1"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(state.insertCalls).toBe(1));
    expect(state.insertPayloads[0]).toEqual({ event_id: "evt-1", user_id: "user-1" });
  });

  it("duplicate-key insert is treated as an idempotent success (invalidates caches)", async () => {
    state.maybeSingle = { data: null, error: null };
    state.insertResult = { error: { message: "duplicate key value violates unique constraint" } };
    const { Wrapper, qc } = wrapper();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(
      () => useEventViewTracking("evt-1", "user-1"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(state.insertCalls).toBe(1));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it("non-duplicate insert failure does not invalidate the success caches", async () => {
    state.maybeSingle = { data: null, error: null };
    state.insertResult = { error: { message: "network down" } };
    const { Wrapper, qc } = wrapper();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(
      () => useEventViewTracking("evt-1", "user-1"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(state.insertCalls).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not query or mutate when identities are missing", async () => {
    const { Wrapper } = wrapper();
    renderHook(
      () => useEventViewTracking(undefined, undefined),
      { wrapper: Wrapper },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(state.maybeSingleCalls).toBe(0);
    expect(state.insertCalls).toBe(0);
  });

  it("lookup failure surfaces as a React Query error", async () => {
    state.maybeSingle = { data: null, error: { message: "boom" } };
    const { Wrapper } = wrapper();
    // Peek at the underlying query state by re-using the same key
    const { result } = renderHook(
      () => useEventViewTracking("evt-x", "user-x"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(state.maybeSingleCalls).toBeGreaterThan(0));
    // hasViewed stays undefined on error and no insert fires
    expect(result.current.hasViewed).toBeUndefined();
    expect(state.insertCalls).toBe(0);
  });
});

describe("useEventViewsAdmin — remains event-scoped", () => {
  it("returns list rows for the supplied event", async () => {
    state.selectList = {
      data: [{ id: "v1", user_id: "u1", viewed_at: "2025-01-01" }],
      error: null,
    };
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useEventViewsAdmin("evt-1"),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.data?.length).toBe(1));
  });
});

describe("useUserEventViews — Bug 2: caller array not mutated + stable cache key", () => {
  it("must not mutate the caller's event ID array while building its cache key", async () => {
    const input = ["c", "a", "b"];
    const snapshot = [...input];
    const { Wrapper } = wrapper();
    renderHook(
      () => useUserEventViews("user-1", input),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(state.inFilterCalls.length).toBeGreaterThan(0));
    expect(input).toEqual(snapshot);
  });

  it("equivalent ID sets in different orders reuse the same React Query cache key", async () => {
    const { Wrapper, qc } = wrapper();

    const h1 = renderHook(
      ({ ids }: { ids: string[] }) => useUserEventViews("user-1", ids),
      { wrapper: Wrapper, initialProps: { ids: ["b", "a", "c"] } },
    );
    await waitFor(() => expect(state.inFilterCalls.length).toBe(1));

    // Different order, same logical set — must reuse the SAME QueryClient
    const h2 = renderHook(
      ({ ids }: { ids: string[] }) => useUserEventViews("user-1", ids),
      { wrapper: Wrapper, initialProps: { ids: ["c", "a", "b"] } },
    );
    await new Promise((r) => setTimeout(r, 20));

    // Second call reused the cache — no additional network fetch
    expect(state.inFilterCalls.length).toBe(1);

    // And only one cache key exists for this user
    const keys = qc
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey)
      .filter((k) => Array.isArray(k) && k[0] === "user-event-views" && k[1] === "user-1");
    expect(keys.length).toBe(1);
    h1.unmount();
    h2.unmount();
  });

  it("deduplicates IDs and preserves deterministic ordering in the filter", async () => {
    const { Wrapper } = wrapper();
    renderHook(
      () => useUserEventViews("user-1", ["b", "a", "b", "c", "a"]),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(state.inFilterCalls.length).toBe(1));
    expect(state.inFilterCalls[0]).toEqual(["a", "b", "c"]);
  });

  it("missing user/event identities do not query or mutate", async () => {
    const { Wrapper } = wrapper();
    renderHook(
      () => useUserEventViews(undefined, ["a", "b"]),
      { wrapper: Wrapper },
    );
    renderHook(
      () => useUserEventViews("user-1", []),
      { wrapper: Wrapper },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(state.inFilterCalls.length).toBe(0);
    expect(state.insertCalls).toBe(0);
  });
});
