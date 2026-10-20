/**
 * Regression tests for useSaveGameResult — ensures the `onlyIfMissing`
 * lookup on `game_results` fails closed. If the pre-write lookup errors
 * (e.g. RLS/permission), the hook MUST NOT proceed with an upsert that
 * could clobber a manually edited result.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSaveGameResult, type SaveGameResultInput } from "./useSaveGameResult";

const liveMocks = vi.hoisted(() => ({
  backend: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  saveLiveGameResult: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  preservedSave:vi.fn(),
  context: { identity: {}, target: {} },
}));
const supabaseMode = liveMocks.backend === "supabase";

vi.mock("@/live/authBackendMode", () => ({
  resolveAuthBackend: () => liveMocks.backend,
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    liveMocks.backend === "icp" ? providers.icp(liveMocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/events", () => ({
  saveLiveGameResult: (...args: unknown[]) => liveMocks.saveLiveGameResult(...args),
}));
vi.mock("@/features/competitions/history/historyRepository",()=>({saveHistoryResult:(...args:unknown[])=>liveMocks.preservedSave(...args)}));

// ---- toast mock --------------------------------------------------------
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// ---- supabase mock -----------------------------------------------------
type Op = "select" | "upsert" | "insert";
const ops: Op[] = [];

let lookupResponse: { data: { id: string } | null; error: { message: string } | null } = {
  data: null,
  error: null,
};
let eventResponse = { data: { competition_match_id: null as string | null }, error: null as { message: string } | null };
let writeError: { message: string } | null = null;
let currentUser: { id: string } | null = { id: "user-1" };

const makeSelectChain = () => ({
  eq: vi.fn(() => ({
    maybeSingle: vi.fn(async () => {
      ops.push("select");
      return lookupResponse;
    }),
  })),
});

const makeFromBuilder = () => ({
  select: vi.fn(() => makeSelectChain()),
  upsert: vi.fn(async () => {
    ops.push("upsert");
    return { error: writeError };
  }),
  insert: vi.fn(async () => {
    ops.push("insert");
    return { error: writeError };
  }),
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => liveMocks.from(...args),
    auth: {
      getUser: (...args: unknown[]) => liveMocks.getUser(...args),
    },
  },
}));

// ---- helpers -----------------------------------------------------------
const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const baseInput = (): SaveGameResultInput => ({
  teamId: "team-1",
  eventId: "evt-1",
  sport: "soccer",
  homeLabel: "Home",
  awayLabel: "Away",
  homeScore: 3,
  awayScore: 1,
  perQuarter: [],
  players: [],
  mvpPlayerId: null,
});

beforeEach(() => {
  liveMocks.backend = supabaseMode ? "supabase" : "icp";
  liveMocks.saveLiveGameResult.mockReset();
  liveMocks.preservedSave.mockReset().mockResolvedValue(undefined);
  liveMocks.getUser.mockReset().mockImplementation(async () => ({ data: { user: currentUser } }));
  liveMocks.from.mockReset().mockImplementation((table: string) => table === "events" ? { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => eventResponse) })) })) } : makeFromBuilder());
  eventResponse = { data: { competition_match_id: null }, error: null };
  ops.length = 0;
  toastSpy.mockReset();
  lookupResponse = { data: null, error: null };
  writeError = null;
  currentUser = { id: "user-1" };
});

// ---- tests -------------------------------------------------------------
describe.runIf(supabaseMode)("useSaveGameResult — onlyIfMissing fail-closed", () => {
  it.each(["denied", "transport"])("refuses history writes on %s and permits retry", async (kind) => {
    eventResponse = { data: { competition_match_id: null }, error: { message: kind } };
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => { expect(await result.current.save(baseInput())).toBe(false); });
    expect(ops).toEqual([]);
    expect(result.current.saved).toBe(false);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    eventResponse = { data: { competition_match_id: null }, error: null };
    await act(async () => { expect(await result.current.save(baseInput())).toBe(true); });
    expect(ops).toEqual(["upsert"]);
  });
  it("preserves competition detail through the manager-authorized atomic save",async()=>{
    eventResponse={data:{competition_match_id:"match-1"},error:null};
    const {result}=renderHook(()=>useSaveGameResult(),{wrapper});
    await act(async()=>expect(await result.current.save(baseInput(),{onlyIfMissing:true})).toBe(true));
    expect(liveMocks.preservedSave).toHaveBeenCalledWith(expect.objectContaining({event_id:"evt-1",home_score:3,away_score:1,period_scores:[],player_stats:[]}),true);
    expect(ops).toEqual([]);
    liveMocks.preservedSave.mockRejectedValueOnce(new Error("Competition manager required"));
    await act(async()=>expect(await result.current.save({...baseInput(),homeScore:4})).toBe(false));
  });

  it("performs the upsert when lookup succeeds with no existing row", async () => {
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput(), { onlyIfMissing: true });
    });
    expect(ops).toEqual(["select", "upsert"]);
    await waitFor(() => expect(result.current.saved).toBe(true));
  });

  it("skips the write when lookup succeeds and a row already exists", async () => {
    lookupResponse = { data: { id: "existing-1" }, error: null };
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput(), { onlyIfMissing: true });
    });
    expect(ops).toEqual(["select"]);
    expect(result.current.saved).toBe(false);
  });

  it("must not overwrite a manual result when the onlyIfMissing lookup fails", async () => {
    lookupResponse = { data: null, error: { message: "row-level security policy" } };
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput(), { onlyIfMissing: true });
    });
    // Only the lookup ran; no insert/upsert.
    expect(ops).toEqual(["select"]);
    expect(ops).not.toContain("upsert");
    expect(ops).not.toContain("insert");
    expect(result.current.saved).toBe(false);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Could not check existing result",
        variant: "destructive",
      }),
    );
  });

  it("suppresses the failure toast in silent mode but still aborts", async () => {
    lookupResponse = { data: null, error: { message: "row-level security policy" } };
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput(), { onlyIfMissing: true, silent: true });
    });
    expect(ops).toEqual(["select"]);
    expect(toastSpy).not.toHaveBeenCalled();
    expect(result.current.saved).toBe(false);
  });

  it("releases the in-flight guard so a subsequent save can be retried", async () => {
    lookupResponse = { data: null, error: { message: "row-level security policy" } };
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput(), { onlyIfMissing: true, silent: true });
    });
    expect(ops).toEqual(["select"]);

    // Second attempt (lookup now succeeds) must be allowed to run.
    lookupResponse = { data: null, error: null };
    await act(async () => {
      await result.current.save(baseInput(), { onlyIfMissing: true });
    });
    expect(ops).toEqual(["select", "select", "upsert"]);
    await waitFor(() => expect(result.current.saved).toBe(true));
  });

  it("shows a permission-oriented message when the lookup RLS-fails and not silent", async () => {
    lookupResponse = { data: null, error: { message: "new row violates row-level security policy" } };
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput(), { onlyIfMissing: true });
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Only team admins or coaches can save games.",
      }),
    );
  });

  it("still runs the upsert path when onlyIfMissing is not set (unchanged)", async () => {
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput());
    });
    expect(ops).toEqual(["upsert"]);
    await waitFor(() => expect(result.current.saved).toBe(true));
  });

  it("uses insert (not upsert) when no eventId is provided", async () => {
    const input = { ...baseInput(), eventId: null };
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(input);
    });
    expect(ops).toEqual(["insert"]);
  });

  it("dedupes identical saves within a session", async () => {
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput());
    });
    await act(async () => {
      await result.current.save(baseInput());
    });
    expect(ops).toEqual(["upsert"]);
  });

  it("force: true bypasses the dedup guard", async () => {
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput());
    });
    await act(async () => {
      await result.current.save(baseInput(), { force: true });
    });
    expect(ops).toEqual(["upsert", "upsert"]);
  });

  it("shows success toast on happy path", async () => {
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput());
    });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Game saved" }),
      ),
    );
  });

  it("no toast / no saved flag when unauthenticated", async () => {
    currentUser = null;
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });
    await act(async () => {
      await result.current.save(baseInput());
    });
    expect(ops).toEqual([]);
    expect(result.current.saved).toBe(false);
  });
});

describe.runIf(!supabaseMode)("useSaveGameResult — ICP adapter", () => {
  beforeEach(() => {
    liveMocks.backend = "icp";
  });

  it("saves the same result contract through events_domain without Supabase access", async () => {
    liveMocks.saveLiveGameResult.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });

    await act(async () => {
      await expect(result.current.save(baseInput(), { onlyIfMissing: true })).resolves.toBe(true);
    });

    expect(liveMocks.saveLiveGameResult).toHaveBeenCalledWith(liveMocks.context, {
      teamId: "team-1",
      eventId: "evt-1",
      sport: "soccer",
      homeLabel: "Home",
      awayLabel: "Away",
      homeScore: 3,
      awayScore: 1,
      periodScoresJson: "[]",
      playerStatsJson: "[]",
      mvpPlayerId: null,
      mvpPlayerName: null,
    });
    expect(liveMocks.getUser).not.toHaveBeenCalled();
    expect(liveMocks.from).not.toHaveBeenCalled();
  });

  it("deduplicates successful ICP writes and reports canister failures", async () => {
    liveMocks.saveLiveGameResult.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("canister denied"));
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });

    await act(async () => {
      await expect(result.current.save(baseInput())).resolves.toBe(true);
      await expect(result.current.save(baseInput())).resolves.toBe(true);
    });
    expect(liveMocks.saveLiveGameResult).toHaveBeenCalledTimes(1);

    await act(async () => {
      await expect(result.current.save({ ...baseInput(), awayScore: 2 }, { force: true })).resolves.toBe(false);
    });
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not save game",
      description: "canister denied",
      variant: "destructive",
    }));
    expect(liveMocks.from).not.toHaveBeenCalled();
  });

  it("force saves bypass the successful-write deduplication guard", async () => {
    liveMocks.saveLiveGameResult.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });

    await act(async () => {
      await result.current.save(baseInput());
      await result.current.save(baseInput(), { force: true });
    });

    expect(liveMocks.saveLiveGameResult).toHaveBeenCalledTimes(2);
  });

  it("suppresses canister failure toasts in silent mode while returning failure", async () => {
    liveMocks.saveLiveGameResult.mockRejectedValueOnce(new Error("canister denied"));
    const { result } = renderHook(() => useSaveGameResult(), { wrapper });

    await act(async () => {
      await expect(result.current.save(baseInput(), { silent: true })).resolves.toBe(false);
    });

    expect(toastSpy).not.toHaveBeenCalled();
    expect(result.current.saved).toBe(false);
  });

  it("invalidates event and team result caches after a successful canister save", async () => {
    liveMocks.saveLiveGameResult.mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const localWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveGameResult(), { wrapper: localWrapper });

    await act(async () => result.current.save(baseInput()));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["match-result", "evt-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["match-score", "evt-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["team-game-events", "team-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["player-stats-report-extras", "team-1"] });
  });
});
