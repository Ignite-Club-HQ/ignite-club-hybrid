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
const backendMocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
  saveSummary: vi.fn(),
  savePlayerStats: vi.fn(),
}));

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
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => backendMocks.mode }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    backendMocks.mode === "icp" ? providers.icp(backendMocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/events", () => ({
  saveLiveGameSummary: (...args: unknown[]) => backendMocks.saveSummary(...args),
  saveLiveGamePlayerStats: (...args: unknown[]) => backendMocks.savePlayerStats(...args),
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
  backendMocks.saveSummary.mockReset().mockResolvedValue(undefined);
  backendMocks.savePlayerStats.mockReset().mockResolvedValue(undefined);
});

// ---- tests -------------------------------------------------------------
describe.runIf(backendMocks.mode === "supabase")("useGameStats — replace workflow error handling", () => {
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

describe.runIf(backendMocks.mode === "icp")("useGameStats ICP workflow", () => {
  it("saves the summary and player stats through events_domain without Supabase calls", async () => {
    const { result } = renderHook(() => useGameStats(), { wrapper });
    await act(async () => result.current.saveGameStats(baseParams()));

    expect(backendMocks.saveSummary).toHaveBeenCalledWith(
      backendMocks.context,
      expect.objectContaining({ eventId: "evt-1", teamId: "team-1", formationUsed: "4-4-2" }),
    );
    expect(backendMocks.savePlayerStats).toHaveBeenCalledWith(
      backendMocks.context,
      "evt-1",
      "team-1",
      expect.arrayContaining([expect.objectContaining({ userId: "p1", minutesPlayed: 60 })]),
    );
    expect(calls).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Game stats saved" }));
  });

  it("does not write player stats when the canister summary save fails", async () => {
    backendMocks.saveSummary.mockRejectedValueOnce(new Error("summary unavailable"));
    const { result } = renderHook(() => useGameStats(), { wrapper });
    await expect(act(async () => result.current.saveGameStats(baseParams()))).rejects.toThrow("summary unavailable");
    expect(backendMocks.savePlayerStats).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("does not invalidate caches or show success when player-stat persistence fails", async () => {
    backendMocks.savePlayerStats.mockRejectedValueOnce(new Error("player stats unavailable"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useGameStats(), { wrapper: localWrapper });

    await expect(act(async () => result.current.saveGameStats(baseParams()))).rejects.toThrow("player stats unavailable");

    expect(backendMocks.saveSummary).toHaveBeenCalledOnce();
    expect(backendMocks.savePlayerStats).toHaveBeenCalledOnce();
    expect(invalidate).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Game stats saved" }));
    expect(rpcCalls).toEqual([]);
  });

  it("invalidates the stats and summary caches only after a successful canister save", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useGameStats(), { wrapper: localWrapper });

    await act(async () => result.current.saveGameStats(baseParams()));

    const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toEqual(["game-stats", "game-summary", "player-stats-report", "game-summary-report"]);
    expect(rpcCalls).toEqual([]);
  });
});
