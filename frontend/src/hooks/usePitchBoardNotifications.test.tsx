/**
 * Regression tests for usePitchBoardNotifications.
 *
 * Core defect: an in-flight preference request from a previous account
 * must NOT overwrite state after the authenticated user changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// ---------- useAuth mock ----------
let currentUser: { id: string } | null = { id: "user-A" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({ user: currentUser }),
}));

// ---------- Supabase mock ----------
type Resp = { data: { pitch_board_enabled: boolean | null } | null; error: unknown };
// Map of user_id -> queued responses (each call shifts one; falls back to last)
const responses: Record<string, Array<Resp | (() => Promise<Resp>)>> = {};
const singleCalls: Array<{ userId: string }> = [];

function nextResp(userId: string): Promise<Resp> {
  const q = responses[userId];
  if (!q || q.length === 0) return Promise.resolve({ data: null, error: null });
  const next = q.length === 1 ? q[0] : q.shift()!;
  return typeof next === "function" ? next() : Promise.resolve(next);
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (_table: string) => {
      const state: { userId: string } = { userId: "" };
      const chain: any = {
        select: () => chain,
        eq: (_col: string, val: string) => {
          state.userId = val;
          return chain;
        },
        single: () => {
          singleCalls.push({ userId: state.userId });
          return nextResp(state.userId);
        },
      };
      return chain;
    },
  },
}));

import {
  usePitchBoardNotifications,
  checkPitchBoardNotificationsEnabled,
} from "./usePitchBoardNotifications";

beforeEach(() => {
  currentUser = { id: "user-A" };
  for (const k of Object.keys(responses)) delete responses[k];
  singleCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePitchBoardNotifications", () => {
  it("defaults to enabled before the preference resolves", () => {
    responses["user-A"] = [new Promise<Resp>(() => {}) as any].map(
      (p) => () => p as Promise<Resp>,
    );
    const { result } = renderHook(() => usePitchBoardNotifications());
    expect(result.current.pitchBoardNotificationsEnabled).toBe(true);
  });

  it("applies enabled=true when preference is true", async () => {
    responses["user-A"] = [{ data: { pitch_board_enabled: true }, error: null }];
    const { result } = renderHook(() => usePitchBoardNotifications());
    await waitFor(() =>
      expect(result.current.pitchBoardNotificationsEnabled).toBe(true),
    );
  });

  it("applies enabled=false when preference is false", async () => {
    responses["user-A"] = [{ data: { pitch_board_enabled: false }, error: null }];
    const { result } = renderHook(() => usePitchBoardNotifications());
    await waitFor(() =>
      expect(result.current.pitchBoardNotificationsEnabled).toBe(false),
    );
  });

  it("treats a null pitch_board_enabled value as enabled", async () => {
    responses["user-A"] = [{ data: { pitch_board_enabled: null }, error: null }];
    const { result } = renderHook(() => usePitchBoardNotifications());
    await waitFor(() => expect(singleCalls.length).toBeGreaterThan(0));
    expect(result.current.pitchBoardNotificationsEnabled).toBe(true);
  });

  it("does not query when there is no user", async () => {
    currentUser = null;
    const { result } = renderHook(() => usePitchBoardNotifications());
    await new Promise((r) => setTimeout(r, 20));
    expect(singleCalls.length).toBe(0);
    expect(result.current.pitchBoardNotificationsEnabled).toBe(true);
  });

  it("must ignore a stale preference response from the previous account", async () => {
    // User A: pending promise we resolve later with `false`
    let resolveA: (v: Resp) => void = () => {};
    const aPromise = new Promise<Resp>((res) => {
      resolveA = res;
    });
    responses["user-A"] = [() => aPromise];
    // User B: immediate response with `true`
    responses["user-B"] = [{ data: { pitch_board_enabled: true }, error: null }];

    const { result, rerender } = renderHook(() => usePitchBoardNotifications());

    // Switch to user B before A resolves
    await act(async () => {
      currentUser = { id: "user-B" };
      rerender();
    });

    // B loads
    await waitFor(() =>
      expect(result.current.pitchBoardNotificationsEnabled).toBe(true),
    );

    // Now A's stale response arrives with `false`
    await act(async () => {
      resolveA({ data: { pitch_board_enabled: false }, error: null });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Must still reflect user B's preference
    expect(result.current.pitchBoardNotificationsEnabled).toBe(true);
  });

  it("re-queries when the user changes", async () => {
    responses["user-A"] = [{ data: { pitch_board_enabled: true }, error: null }];
    responses["user-B"] = [{ data: { pitch_board_enabled: false }, error: null }];
    const { result, rerender } = renderHook(() => usePitchBoardNotifications());
    await waitFor(() =>
      expect(result.current.pitchBoardNotificationsEnabled).toBe(true),
    );

    await act(async () => {
      currentUser = { id: "user-B" };
      rerender();
    });

    await waitFor(() =>
      expect(result.current.pitchBoardNotificationsEnabled).toBe(false),
    );
    expect(singleCalls.map((c) => c.userId)).toEqual(["user-A", "user-B"]);
  });

  it("does not update state after unmount", async () => {
    let resolveA: (v: Resp) => void = () => {};
    responses["user-A"] = [
      () =>
        new Promise<Resp>((res) => {
          resolveA = res;
        }),
    ];
    const { result, unmount } = renderHook(() => usePitchBoardNotifications());
    unmount();
    await act(async () => {
      resolveA({ data: { pitch_board_enabled: false }, error: null });
      await new Promise((r) => setTimeout(r, 0));
    });
    // Still the default; no warnings expected either
    expect(result.current.pitchBoardNotificationsEnabled).toBe(true);
  });
});

describe("checkPitchBoardNotificationsEnabled (standalone)", () => {
  it("returns true for a missing userId without querying", async () => {
    const v = await checkPitchBoardNotificationsEnabled("");
    expect(v).toBe(true);
    expect(singleCalls.length).toBe(0);
  });

  it("returns the stored preference when present", async () => {
    responses["user-X"] = [{ data: { pitch_board_enabled: false }, error: null }];
    const v = await checkPitchBoardNotificationsEnabled("user-X");
    expect(v).toBe(false);
  });
});
