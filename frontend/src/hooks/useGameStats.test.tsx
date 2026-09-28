/**
 * Regression tests for useGameStats — ensures the "replace player stats"
 * workflow inspects every Supabase error rather than silently ignoring them.
 *
 * Confirmed defect (fixed): the delete on game_player_stats did not check
 * the returned error, so a failed delete could still be followed by inserts
 * (duplicates), an email send, cache invalidations, and a "Game stats saved"
 * toast — reporting success when the DB was in a partial state.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGameStats } from "./useGameStats";

// ---- toast mock --------------------------------------------------------
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// ---- supabase mock -----------------------------------------------------
type CallLog = {
  table: string;
  op: "upsert" | "delete" | "insert";
};

const calls: CallLog[] = [];
const rpcCalls: string[] = [];

// Configurable per-test error responses
let summaryError: { message: string } | null = null;
let deleteError: { message: string } | null = null;
let insertError: { message: string } | null = null;

const makeTableBuilder = (table: string) => ({
  upsert: vi.fn(async () => {
    calls.push({ table, op: "upsert" });
    return { error: summaryError };
  }),
  delete: vi.fn(() => ({
    eq: vi.fn(async () => {
      calls.push({ table, op: "delete" });
      return { error: deleteError };
    }),
  })),
  insert: vi.fn(async () => {
    calls.push({ table, op: "insert" });
    return { error: insertError };
  }),
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeTableBuilder(table),
    rpc: vi.fn(async (name: string) => {
      rpcCalls.push(name);
      return { error: null };
    }),
  },
}));

// ---- helpers -----------------------------------------------------------
const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const baseParams = () => ({
  eventId: "evt-1",
  teamId: "team-1",
  players: [
    {
      id: "p1",
      name: "Alice",
      number: 7,
      position: { x: 0.5, y: 0.5 },
      assignedPositions: [] as never[],
      minutesPlayed: 60,
      isFillIn: false,
    },
  ],
  totalGameTime: 3600,
  halfDuration: 1800,
  formationUsed: "4-4-2",
  teamSize: 11,
  executedSubs: [],
  goals: [],
  eventTitle: "Game",
  eventDate: "2026-07-19",
  opponent: "Rivals",
});

beforeEach(() => {
  calls.length = 0;
  rpcCalls.length = 0;
  toastSpy.mockReset();
  summaryError = null;
  deleteError = null;
  insertError = null;
});

// ---- tests -------------------------------------------------------------
describe("useGameStats — replace workflow error handling", () => {
  it("happy path: upsert summary, delete old stats, insert new stats, send email, show success toast", async () => {
    const { result } = renderHook(() => useGameStats(), { wrapper });
    await act(async () => {
      await result.current.saveGameStats(baseParams());
    });
    const ops = calls.map((c) => `${c.table}:${c.op}`);
    expect(ops).toEqual([
      "game_summaries:upsert",
      "game_player_stats:delete",
      "game_player_stats:insert",
    ]);
    expect(rpcCalls).toContain("send_game_stats_email_rpc");
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Game stats saved" }),
      ),
    );
  });

  it("stops immediately when the game_summaries upsert fails", async () => {
    summaryError = { message: "summary boom" };
    const { result } = renderHook(() => useGameStats(), { wrapper });
    await expect(
      act(async () => {
        await result.current.saveGameStats(baseParams());
      }),
    ).rejects.toThrow(/summary boom/);
    const ops = calls.map((c) => `${c.table}:${c.op}`);
    expect(ops).toEqual(["game_summaries:upsert"]);
    expect(rpcCalls).not.toContain("send_game_stats_email_rpc");
  });

  it("must stop and preserve existing player stats when deleting the old rows fails", async () => {
    deleteError = { message: "delete boom" };
    const { result } = renderHook(() => useGameStats(), { wrapper });
    await expect(
      act(async () => {
        await result.current.saveGameStats(baseParams());
      }),
    ).rejects.toThrow(/Failed to replace player stats: delete boom/);

    const ops = calls.map((c) => `${c.table}:${c.op}`);
    // Summary was written first; delete attempted and failed; NO insert must follow.
    expect(ops).toEqual([
      "game_summaries:upsert",
      "game_player_stats:delete",
    ]);
    // No email dispatch on failure.
    expect(rpcCalls).not.toContain("send_game_stats_email_rpc");
    // No success toast on failure.
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Game stats saved" }),
    );
  });

  it("throws when the insert of new player stats fails", async () => {
    insertError = { message: "insert boom" };
    const { result } = renderHook(() => useGameStats(), { wrapper });
    await expect(
      act(async () => {
        await result.current.saveGameStats(baseParams());
      }),
    ).rejects.toThrow(/insert boom/);
    const ops = calls.map((c) => `${c.table}:${c.op}`);
    expect(ops).toEqual([
      "game_summaries:upsert",
      "game_player_stats:delete",
      "game_player_stats:insert",
    ]);
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Game stats saved" }),
    );
  });

  it("treats email dispatch failure as non-fatal after stats are safely stored", async () => {
    const supabaseModule = await import("@/integrations/supabase/client");
    (supabaseModule.supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        throw new Error("email boom");
      },
    );
    const { result } = renderHook(() => useGameStats(), { wrapper });
    await act(async () => {
      await result.current.saveGameStats(baseParams());
    });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Game stats saved" }),
      ),
    );
  });

  it("invalidates game-stats and game-summary caches only on successful save", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    deleteError = { message: "delete boom" };
    const { result } = renderHook(() => useGameStats(), { wrapper: localWrapper });
    await expect(
      act(async () => {
        await result.current.saveGameStats(baseParams());
      }),
    ).rejects.toThrow();

    const invalidatedKeys = invalidateSpy.mock.calls
      .map((c) => (c[0] as { queryKey?: unknown[] })?.queryKey?.[0])
      .filter(Boolean);
    expect(invalidatedKeys).not.toContain("game-stats");
    expect(invalidatedKeys).not.toContain("game-summary");
  });
});
