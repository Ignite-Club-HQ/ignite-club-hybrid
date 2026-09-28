/**
 * Regression tests for useChatSharedMedia.
 *
 * Core defect: the derived shared-media array was never truncated to the
 * caller-supplied `limit`. A single source message can produce multiple
 * derived items (photo + vault refs + external links), so bounding only
 * the source-message query could still return more items than requested.
 *
 * These tests exercise the derivation + limit-enforcement path only. The
 * chat-type scope filters, deleted-message exclusion, vault parsing, link
 * parsing / dedup, and profile lookup behaviours are intentionally left
 * unchanged and are covered by the existing shape of the mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------- profile cache mock ----------
vi.mock("@/lib/profileCache", () => ({
  selectCachedProfilesByIds: async () => ({ data: [] }),
}));

// ---------- Supabase mock ----------
type Row = {
  id: string;
  image_url: string | null;
  text: string | null;
  created_at: string;
  author_id: string;
};

let messageRows: Row[] = [];
let lastFetchLimit = 0;
const lastFilters: Record<string, unknown> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      // vault lookups return empty arrays — parsing itself is not the SUT.
      if (table === "vault_files" || table === "vault_folders") {
        const chain: any = {
          select: () => chain,
          in: () => Promise.resolve({ data: [], error: null }),
        };
        return chain;
      }
      // Message table chain: select().is().order().limit().eq()
      const chain: any = {
        select: () => chain,
        is: () => chain,
        order: () => chain,
        limit: (n: number) => {
          lastFetchLimit = n;
          return chain;
        },
        eq: (col: string, val: unknown) => {
          lastFilters[col] = val;
          return chain;
        },
        then: (resolve: (v: { data: Row[]; error: null }) => void) =>
          resolve({ data: messageRows.slice(0, lastFetchLimit), error: null }),
      };
      return chain;
    },
  },
}));

import { useChatSharedMedia } from "./useChatSharedMedia";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function mkRow(overrides: Partial<Row> & { id: string }): Row {
  return {
    image_url: null,
    text: null,
    created_at: new Date(2024, 0, 1).toISOString(),
    author_id: "author-1",
    ...overrides,
  };
}

beforeEach(() => {
  messageRows = [];
  lastFetchLimit = 0;
  for (const k of Object.keys(lastFilters)) delete lastFilters[k];
});

afterEach(() => {
  vi.clearAllMocks();
});


describe("useChatSharedMedia — result-limit enforcement", () => {
  it("must enforce the requested result limit after deriving media items", async () => {
    // One message → one photo + three external links → 4 derived items.
    messageRows = [
      mkRow({
        id: "m1",
        image_url: "https://reference.invalid",
        text: "see https://reference.invalid https://reference.invalid and https://reference.invalid",
      }),
    ];
    const { result } = renderHook(
      () => useChatSharedMedia("team", "team-1", { limit: 2 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeDefined();
    expect(result.current.data!.length).toBe(2);
  });

  it("returns exactly the requested number when derivations equal the limit", async () => {
    messageRows = [
      mkRow({ id: "m1", image_url: "https://reference.invalid", created_at: "2024-01-03T00:00:00Z" }),
      mkRow({ id: "m2", image_url: "https://reference.invalid", created_at: "2024-01-02T00:00:00Z" }),
      mkRow({ id: "m3", image_url: "https://reference.invalid", created_at: "2024-01-01T00:00:00Z" }),
    ];
    const { result } = renderHook(
      () => useChatSharedMedia("club", "club-1", { limit: 3 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.length).toBe(3);
  });

  it("returns fewer items than the limit when few are available", async () => {
    messageRows = [mkRow({ id: "m1", image_url: "https://reference.invalid" })];
    const { result } = renderHook(
      () => useChatSharedMedia("group", "group-1", { limit: 12 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.length).toBe(1);
  });

  it("applies the default limit of 12 when omitted", async () => {
    messageRows = Array.from({ length: 20 }, (_, i) =>
      mkRow({
        id: `m${i}`,
        image_url: `https://reference.invalid`,
        created_at: new Date(2024, 0, 20 - i).toISOString(),
      }),
    );
    const { result } = renderHook(
      () => useChatSharedMedia("dm", "dm-1"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.length).toBe(12);
  });

  it("preserves newest-first ordering before truncation", async () => {
    messageRows = [
      mkRow({ id: "old", image_url: "https://reference.invalid", created_at: "2024-01-01T00:00:00Z" }),
      mkRow({ id: "mid", image_url: "https://reference.invalid", created_at: "2024-06-01T00:00:00Z" }),
      mkRow({ id: "new", image_url: "https://reference.invalid", created_at: "2024-12-01T00:00:00Z" }),
    ];
    const { result } = renderHook(
      () => useChatSharedMedia("team", "team-1", { limit: 2 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const items = result.current.data!;
    expect(items.length).toBe(2);
    // First item is the newest, second is the middle-dated one.
    expect(items[0].message_id).toBe("new");
    expect(items[1].message_id).toBe("mid");
  });

  it("handles multiple derived items from a single message under the limit", async () => {
    messageRows = [
      mkRow({
        id: "m1",
        image_url: "https://reference.invalid",
        text: "hey https://reference.invalid",
      }),
    ];
    const { result } = renderHook(
      () => useChatSharedMedia("broadcast", undefined as unknown as string, {
        limit: 10,
        enabled: true,
      }),
      { wrapper: wrapper() },
    );
    // broadcast has no column filter, but chatId is still required by `enabled`.
    // Re-run with a defined chatId to actually exercise derivation.
    expect(result.current.isFetching || result.current.isPending).toBe(true);

    const { result: r2 } = renderHook(
      () => useChatSharedMedia("broadcast", "bcast", { limit: 10 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));
    // 1 photo + 1 link = 2 derived items from a single message.
    expect(r2.current.data!.length).toBe(2);
  });

  it("falls back to the safe default for invalid, zero or negative limits", async () => {
    messageRows = Array.from({ length: 20 }, (_, i) =>
      mkRow({
        id: `m${i}`,
        image_url: `https://reference.invalid`,
        created_at: new Date(2024, 0, 20 - i).toISOString(),
      }),
    );

    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { result } = renderHook(
        () =>
          useChatSharedMedia("team", `team-${String(bad)}`, {
            limit: bad as number,
          }),
        { wrapper: wrapper() },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data!.length).toBe(12);
      // Bounded source-message query — never unbounded.
      expect(lastFetchLimit).toBeGreaterThan(0);
      expect(lastFetchLimit).toBeLessThanOrEqual(60);
    }
  });

  it("normalises fractional limits to an integer", async () => {
    messageRows = Array.from({ length: 10 }, (_, i) =>
      mkRow({
        id: `m${i}`,
        image_url: `https://reference.invalid`,
        created_at: new Date(2024, 0, 20 - i).toISOString(),
      }),
    );
    const { result } = renderHook(
      () => useChatSharedMedia("team", "team-frac", { limit: 3.7 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.length).toBe(3);
  });
});
