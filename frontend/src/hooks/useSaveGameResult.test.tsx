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
    from: vi.fn(() => makeFromBuilder()),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: currentUser } })),
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
  ops.length = 0;
  toastSpy.mockReset();
  lookupResponse = { data: null, error: null };
  writeError = null;
  currentUser = { id: "user-1" };
});

// ---- tests -------------------------------------------------------------
describe("useSaveGameResult — onlyIfMissing fail-closed", () => {
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
