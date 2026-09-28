/**
 * Regression tests for useAutoSubNotify — ensures the deduplication key is
 * only recorded as "sent" AFTER recipient discovery succeeds (or is
 * legitimately empty) or at least one push is dispatched. A failed lookup
 * that dispatches nothing must remain retryable within the same minute.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSubNotify } from "./useAutoSubNotify";

// ---- pitchBoardNotifyFlags mock ---------------------------------------
let flagsMock: { coach: boolean; team_admin: boolean; subs_manager: boolean } = {
  coach: true,
  team_admin: true,
  subs_manager: true,
};
vi.mock("@/components/pitch/pitchBoardNotifyFlags", () => ({
  loadPitchNotifyFlags: vi.fn(async () => flagsMock),
  enabledRoleListFromFlags: (f: typeof flagsMock) => {
    const r: string[] = [];
    if (f.team_admin) r.push("team_admin");
    if (f.coach) r.push("coach");
    return r;
  },
}));

// ---- supabase mock ----------------------------------------------------
type Row = { assigned_to?: string | null; user_id?: string | null };
type TableResp = { data: Row[] | null; error: { message: string } | null };

// Per-table configurable responses.
const tableResponses: Record<string, TableResp | (() => TableResp)> = {};
const tableCalls: Record<string, number> = {};
const tableFilters: Record<string, Array<[string, ...unknown[]]>> = {};

const makeChain = (table: string) => {
  const resolve = () => {
    tableCalls[table] = (tableCalls[table] ?? 0) + 1;
    const r = tableResponses[table];
    return Promise.resolve(typeof r === "function" ? r() : (r ?? { data: [], error: null }));
  };
  const chain: any = {
    select: () => chain,
    eq: (...args: unknown[]) => { (tableFilters[table] ||= []).push(["eq", ...args]); return chain; },
    in: (...args: unknown[]) => { (tableFilters[table] ||= []).push(["in", ...args]); return chain; },
    not: (...args: unknown[]) => { (tableFilters[table] ||= []).push(["not", ...args]); return chain; },
    then: (onF: any, onR: any) => resolve().then(onF, onR),
  };
  return chain;
};


const invokeSpy = vi.fn(async () => ({ data: null, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeChain(table),
    functions: {
      invoke: (...args: unknown[]) => invokeSpy(...(args as [])),
    },
  },
}));

// ---- helpers ----------------------------------------------------------
const baseArgs = {
  playerInName: "Alice",
  playerOutName: "Bob",
  position: "GK",
  periodLabel: "Q2",
};

beforeEach(() => {
  Object.keys(tableResponses).forEach((k) => delete tableResponses[k]);
  Object.keys(tableCalls).forEach((k) => delete tableCalls[k]);
  Object.keys(tableFilters).forEach((k) => delete tableFilters[k]);
  invokeSpy.mockClear();
  flagsMock = { coach: true, team_admin: true, subs_manager: true };
});

// ---- tests ------------------------------------------------------------
describe("useAutoSubNotify — retry-safe dedup", () => {
  it("dispatches to team_admin/coach when role lookup succeeds", async () => {
    tableResponses.user_roles = {
      data: [{ user_id: "u1" }, { user_id: "u2" }],
      error: null,
    };
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Team"));
    await act(async () => {
      await result.current(baseArgs);
    });
    expect(invokeSpy).toHaveBeenCalledTimes(2);
  });

  it("deduplicates a user who is both coach and Subs Manager and excludes every undiscovered player", async () => {
    tableResponses.user_roles = { data: [{ user_id: "coach-and-manager" }, { user_id: "coach-only" }], error: null };
    tableResponses.duties = { data: [{ assigned_to: "coach-and-manager" }, { assigned_to: "manager-only" }], error: null };
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Team", "event-9"));
    await act(async () => result.current(baseArgs));
    const recipients = invokeSpy.mock.calls.map((call) => (call[1] as any).body.userId).sort();
    expect(recipients).toEqual(["coach-and-manager", "coach-only", "manager-only"]);
    expect(recipients).not.toContain("ordinary-player");
    expect(tableFilters.duties).toEqual(expect.arrayContaining([
      ["eq", "event_id", "event-9"],
      ["eq", "name", "Subs Manager"],
      ["not", "assigned_to", "is", null],
    ]));
  });

  it("dedupes identical sub in the same minute after a completed dispatch", async () => {
    tableResponses.user_roles = { data: [{ user_id: "u1" }], error: null };
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Team"));
    await act(async () => {
      await result.current(baseArgs);
      await result.current(baseArgs);
    });
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    // Second attempt short-circuited before hitting the table again.
    expect(tableCalls.user_roles).toBe(1);
  });

  it("a different period label is a distinct notification", async () => {
    tableResponses.user_roles = { data: [{ user_id: "u1" }], error: null };
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Team"));
    await act(async () => {
      await result.current(baseArgs);
      await result.current({ ...baseArgs, periodLabel: "Q3" });
    });
    expect(invokeSpy).toHaveBeenCalledTimes(2);
  });

  it("allows retry in the same minute when recipient discovery failed before any push was sent", async () => {
    // First attempt: role lookup errors, no subs-manager linked → nobody
    // discovered → key must NOT be recorded as sent.
    tableResponses.user_roles = { data: null, error: { message: "boom" } };
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Team"));
    await act(async () => {
      await result.current(baseArgs);
    });
    expect(invokeSpy).not.toHaveBeenCalled();

    // Second attempt within the same minute: lookup now succeeds → dispatch.
    tableResponses.user_roles = { data: [{ user_id: "u1" }], error: null };
    await act(async () => {
      await result.current(baseArgs);
    });
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("two concurrent calls for the same dedupe key dispatch only one push batch", async () => {
    tableResponses.user_roles = () => ({
      data: [{ user_id: "u1" }],
      error: null,
    });
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Team"));
    await act(async () => {
      await Promise.all([result.current(baseArgs), result.current(baseArgs)]);
    });
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("legitimately empty recipient result does not cause a lookup every second", async () => {
    tableResponses.user_roles = { data: [], error: null };
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Team"));
    await act(async () => {
      await result.current(baseArgs);
      await result.current(baseArgs);
      await result.current(baseArgs);
    });
    expect(invokeSpy).not.toHaveBeenCalled();
    expect(tableCalls.user_roles).toBe(1);
  });

  it("partial lookup failure still notifies recipients discovered through another source", async () => {
    // role lookup fails, but subs-manager lookup returns a recipient.
    tableResponses.user_roles = { data: null, error: { message: "boom" } };
    tableResponses.duties = {
      data: [{ assigned_to: "sm-1" }],
      error: null,
    };
    const { result } = renderHook(() =>
      useAutoSubNotify("team-1", "Team", "evt-1"),
    );
    await act(async () => {
      await result.current(baseArgs);
    });
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    // Because at least one source succeeded, the key is now recorded as sent.
    await act(async () => {
      await result.current(baseArgs);
    });
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it("includes Subs Manager duty assignees when linkedEventId + flag on", async () => {
    tableResponses.user_roles = { data: [{ user_id: "u1" }], error: null };
    tableResponses.duties = { data: [{ assigned_to: "sm-1" }], error: null };
    const { result } = renderHook(() =>
      useAutoSubNotify("team-1", "Team", "evt-1"),
    );
    await act(async () => {
      await result.current(baseArgs);
    });
    // Deduped by set → u1 + sm-1 = 2 invokes.
    expect(invokeSpy).toHaveBeenCalledTimes(2);
  });

  it("mini-league event group notifies Referee + Subs Manager assignees", async () => {
    tableResponses.event_group_duties = {
      data: [{ assigned_to: "ref-1" }, { assigned_to: "sm-1" }],
      error: null,
    };
    const { result } = renderHook(() =>
      useAutoSubNotify("event-group-g1", "MiniLeague"),
    );
    await act(async () => {
      await result.current(baseArgs);
    });
    expect(invokeSpy).toHaveBeenCalledTimes(2);
    // team-role table must not be queried for mini-league groups.
    expect(tableCalls.user_roles).toBeUndefined();
  });

  it("mini-league notification lookup is isolated to one match group", async () => {
    tableResponses.event_group_duties = { data: [{ assigned_to: "this-match-ref" }], error: null };
    const { result } = renderHook(() => useAutoSubNotify("event-group-match-44", "Final"));
    await act(async () => result.current(baseArgs));
    expect(tableFilters.event_group_duties).toContainEqual(["eq", "group_id", "match-44"]);
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    expect((invokeSpy.mock.calls[0][1] as any).body.userId).toBe("this-match-ref");
  });

  it("muted flags do not query user_roles or duties", async () => {
    flagsMock = { coach: false, team_admin: false, subs_manager: false };
    const { result } = renderHook(() =>
      useAutoSubNotify("team-1", "Team", "evt-1"),
    );
    await act(async () => {
      await result.current(baseArgs);
    });
    expect(tableCalls.user_roles).toBeUndefined();
    expect(tableCalls.duties).toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("empty teamId is a no-op (no queries, no pushes)", async () => {
    const { result } = renderHook(() => useAutoSubNotify("", "Team"));
    await act(async () => {
      await result.current(baseArgs);
    });
    expect(invokeSpy).not.toHaveBeenCalled();
    expect(Object.keys(tableCalls)).toHaveLength(0);
  });

  it("does not let a rejected push invocation escape as an unhandled rejection", async () => {
    tableResponses.user_roles = { data: [{ user_id: "u1" }], error: null };
    invokeSpy.mockImplementationOnce(async () => {
      throw new Error("push boom");
    });
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Team"));
    await expect(
      act(async () => {
        await result.current(baseArgs);
      }),
    ).resolves.not.toThrow();
  });
});
