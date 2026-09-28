/**
 * Soccer pitch board (`useActiveGameSync`) concurrency tests.
 *
 * Soccer doesn't have its own spectator hook (the read side `useCourtSpectator`
 * only projects basketball/netball). The contention surface for soccer is the
 * WRITE side: at scale, many coaches run pitch boards for many teams in
 * parallel, and each board pushes to the shared `active_games` table every
 * ~10s. These tests verify the multi-tenant guarantees that keep that table
 * consistent under load:
 *
 *   1. Each hook mount stamps a stable `board_session_id` on every write so
 *      spectators can lock onto a single coach's session.
 *   2. Two coaches running boards for DIFFERENT teams never overwrite each
 *      other's row — the (user, team) scope on the existing-row lookup must
 *      be respected.
 *   3. A 23505 unique-violation race (two coaches trying to claim the same
 *      team simultaneously) is recovered by adopting the existing row instead
 *      of leaving the board un-synced.
 *   4. Recovery preserves `board_session_id` so the spectator stays locked.
 *   5. The write-rate monitor is invoked for every write, regardless of
 *      whether it was an insert, update, or 23505 recovery path.
 *   6. A single coach running boards for two teams concurrently keeps both
 *      `is_active` simultaneously — the (user, team)-scoped deactivation
 *      filter must not flip the other team off.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

// ────────────────────────────────────────────────────────────────────────────
// Test-controlled supabase mock
// ────────────────────────────────────────────────────────────────────────────
type WriteOp = {
  table: string;
  op: "insert" | "update" | "select";
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
};

const writeLog: WriteOp[] = [];

interface FakeRow {
  id: string;
  user_id: string;
  team_id: string | null;
  is_active: boolean;
  updated_at: string;
  board_session_id?: string | null;
  pitch_state?: unknown;
  timer_state?: unknown;
}

let fakeRows: FakeRow[] = [];
// When set, the next insert resolves with a 23505 error and writes a "stolen"
// row to fakeRows so the recovery path has something to claim.
let nextInsertConflict: { stealRow: FakeRow } | null = null;
let rowIdSeq = 0;

const recordSyncWriteSpy = vi.fn();

vi.mock("@/lib/syncWriteRateMonitor", () => ({
  recordSyncWrite: (...args: unknown[]) => recordSyncWriteSpy(...args),
}));

vi.mock("./useAuth", () => ({
  useAuth: () => ({ user: { id: "coach-A-user" } }),
}));

const buildQuery = (table: string) => {
  const filters: Record<string, unknown> = {};
  let mode: "select" | "update" | "insert" = "select";
  let updatePayload: Record<string, unknown> | undefined;
  let insertPayload: Record<string, unknown> | undefined;
  let orderDir: "asc" | "desc" = "desc";
  let limitN: number | undefined;

  const exec = async (): Promise<{ data: unknown; error: unknown }> => {
    if (mode === "insert" && insertPayload) {
      writeLog.push({ table, op: "insert", payload: insertPayload, filters: {} });
      if (nextInsertConflict) {
        const stolen = nextInsertConflict.stealRow;
        fakeRows.push(stolen);
        nextInsertConflict = null;
        return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      const newRow: FakeRow = {
        id: `row-${++rowIdSeq}`,
        user_id: insertPayload.user_id as string,
        team_id: (insertPayload.team_id as string | null) ?? null,
        is_active: insertPayload.is_active === true,
        updated_at: (insertPayload.updated_at as string) ?? new Date().toISOString(),
        board_session_id: insertPayload.board_session_id as string | undefined,
        pitch_state: insertPayload.pitch_state,
        timer_state: insertPayload.timer_state,
      };
      fakeRows.push(newRow);
      return { data: newRow, error: null };
    }

    if (mode === "update" && updatePayload) {
      writeLog.push({ table, op: "update", payload: updatePayload, filters: { ...filters } });
      const matching = fakeRows.filter((r) => matchesFilters(r, filters));
      for (const row of matching) Object.assign(row, updatePayload);
      return { data: matching, error: null };
    }

    // select
    let result = fakeRows.filter((r) => matchesFilters(r, filters));
    result = [...result].sort((a, b) =>
      orderDir === "desc"
        ? b.updated_at.localeCompare(a.updated_at)
        : a.updated_at.localeCompare(b.updated_at)
    );
    if (limitN !== undefined) result = result.slice(0, limitN);
    writeLog.push({ table, op: "select", filters: { ...filters } });
    return { data: result, error: null };
  };

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = (col: string, val: unknown) => {
    filters[col] = val;
    return builder;
  };
  builder.is = (col: string, val: unknown) => {
    filters[col] = val;
    return builder;
  };
  builder.neq = (col: string, val: unknown) => {
    filters[`__neq__${col}`] = val;
    return builder;
  };
  builder.order = (_col: string, opts?: { ascending?: boolean }) => {
    orderDir = opts?.ascending ? "asc" : "desc";
    return builder;
  };
  builder.limit = (n: number) => {
    limitN = n;
    return builder;
  };
  builder.maybeSingle = async () => {
    const { data, error } = await exec();
    return { data: Array.isArray(data) ? data[0] ?? null : data, error };
  };
  builder.single = async () => {
    const { data, error } = await exec();
    return { data: Array.isArray(data) ? data[0] ?? null : data, error };
  };
  builder.update = (payload: Record<string, unknown>) => {
    mode = "update";
    updatePayload = payload;
    // updates resolve when the chain is awaited (via .eq returning builder
    // that's then awaited). To support both `.update().eq(...)` (no await on
    // the chain — supabase resolves on the trailing `.eq`) and an explicit
    // await, we attach a `then` to the builder so awaiting it executes.
    builder.then = (resolve: (v: unknown) => void) => exec().then(resolve);
    return builder;
  };
  builder.insert = (payload: Record<string, unknown>) => {
    mode = "insert";
    insertPayload = payload;
    builder.then = (resolve: (v: unknown) => void) => exec().then(resolve);
    return builder;
  };

  // Default: when select chain is awaited directly.
  builder.then = (resolve: (v: unknown) => void) => exec().then(resolve);
  return builder;
};

function matchesFilters(row: FakeRow, filters: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filters)) {
    if (k.startsWith("__neq__")) {
      const col = k.replace("__neq__", "") as keyof FakeRow;
      if (row[col] === v) return false;
      continue;
    }
    if ((row as unknown as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => buildQuery(table)),
  },
}));

// Import AFTER the mocks.
import { useActiveGameSync } from "./useActiveGameSync";

// ────────────────────────────────────────────────────────────────────────────
// Helpers — write what the soccer board would have written to localStorage so
// the hook's `loadTimerState`/`loadPitchState` succeed.
// ────────────────────────────────────────────────────────────────────────────
const TIMER_KEY = "pitch-board-timer-state";
const PITCH_KEY_BASE = "ignite-pitch-board-state-team";

const seedSoccerBoard = (teamId: string) => {
  const timerState = {
    elapsedSeconds: 60,
    isRunning: true,
    currentHalf: 1,
    minutesPerHalf: 25,
    lastUpdateTime: Date.now(),
    teamName: `Team ${teamId}`,
    teamId,
  };
  const pitchState = {
    players: [{ id: "p1", name: "Player 1" }],
    autoSubPlan: [],
    autoSubActive: true,
  };
  localStorage.setItem(TIMER_KEY, JSON.stringify(timerState));
  localStorage.setItem(`${PITCH_KEY_BASE}-${teamId}`, JSON.stringify(pitchState));
};

const insertWrites = () => writeLog.filter((w) => w.op === "insert" && w.table === "active_games");
const updateWrites = () => writeLog.filter((w) => w.op === "update" && w.table === "active_games");

beforeEach(() => {
  writeLog.length = 0;
  fakeRows = [];
  nextInsertConflict = null;
  rowIdSeq = 0;
  recordSyncWriteSpy.mockClear();
  localStorage.clear();
});

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────
describe("useActiveGameSync soccer multi-tenant write concurrency", () => {
  it("stamps a stable board_session_id on insert and every subsequent update", async () => {
    seedSoccerBoard("team-001");
    const { result } = renderHook(() => useActiveGameSync());

    await act(async () => {
      await result.current.forceSync();
    });
    await act(async () => {
      await result.current.forceSync();
    });
    await act(async () => {
      await result.current.forceSync();
    });

    const inserts = insertWrites();
    const updates = updateWrites().filter(
      (u) => u.payload && "board_session_id" in (u.payload as Record<string, unknown>)
    );

    expect(inserts.length).toBe(1);
    const sessionId = inserts[0].payload?.board_session_id as string;
    expect(sessionId).toBeTruthy();
    // Every subsequent update carries the SAME session id.
    for (const u of updates) {
      expect(u.payload?.board_session_id).toBe(sessionId);
    }
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it("two boards for different teams never adopt each other's row", async () => {
    // Coach already has an active row for team-OTHER (from a prior board).
    fakeRows.push({
      id: "row-other-team",
      user_id: "coach-A-user",
      team_id: "team-OTHER",
      is_active: true,
      updated_at: new Date(Date.now() - 60_000).toISOString(),
      board_session_id: "session-other",
    });

    seedSoccerBoard("team-NEW");
    const { result } = renderHook(() => useActiveGameSync());
    await act(async () => {
      await result.current.forceSync();
    });

    // Should INSERT a fresh row for team-NEW — must not touch team-OTHER.
    const inserts = insertWrites();
    expect(inserts.length).toBe(1);
    expect(inserts[0].payload?.team_id).toBe("team-NEW");

    const otherRow = fakeRows.find((r) => r.team_id === "team-OTHER");
    expect(otherRow?.is_active).toBe(true);
    expect(otherRow?.board_session_id).toBe("session-other");

    // No update ever targeted row-other-team.
    const updatesAgainstOther = updateWrites().filter(
      (u) => (u.filters as Record<string, unknown>).id === "row-other-team"
    );
    expect(updatesAgainstOther.length).toBe(0);
  });

  it("recovers from a 23505 unique-violation race by claiming the existing row", async () => {
    seedSoccerBoard("team-RACE");

    // Simulate Coach B's row already existing the moment we try to insert.
    nextInsertConflict = {
      stealRow: {
        id: "row-coachB-claimed",
        user_id: "coach-B-user",
        team_id: "team-RACE",
        is_active: true,
        updated_at: new Date().toISOString(),
        board_session_id: "session-coachB",
      },
    };

    const { result } = renderHook(() => useActiveGameSync());
    await act(async () => {
      await result.current.forceSync();
    });

    const inserts = insertWrites();
    expect(inserts.length).toBe(1);

    // The recovery path must have written an UPDATE against the claimed row
    // and stamped OUR session id (so the spectator follows OUR coach now).
    const claimUpdate = updateWrites().find(
      (u) => (u.filters as Record<string, unknown>).id === "row-coachB-claimed"
    );
    expect(claimUpdate).toBeTruthy();
    expect(claimUpdate?.payload?.team_id).toBe("team-RACE");
    expect(claimUpdate?.payload?.board_session_id).toBe(
      inserts[0].payload?.board_session_id
    );
    expect(claimUpdate?.payload?.is_active).toBe(true);
  });

  it("the recovered row carries the SAME session id on the next sync tick", async () => {
    seedSoccerBoard("team-RACE-2");

    nextInsertConflict = {
      stealRow: {
        id: "row-claimed-2",
        user_id: "coach-other",
        team_id: "team-RACE-2",
        is_active: true,
        updated_at: new Date().toISOString(),
        board_session_id: "session-other-coach",
      },
    };

    const { result } = renderHook(() => useActiveGameSync());
    await act(async () => {
      await result.current.forceSync();
    });
    await act(async () => {
      await result.current.forceSync();
    });

    const sessionFromInsert = insertWrites()[0].payload?.board_session_id as string;
    const updatesOnClaimedRow = updateWrites().filter(
      (u) =>
        (u.filters as Record<string, unknown>).id === "row-claimed-2" &&
        u.payload &&
        "board_session_id" in (u.payload as Record<string, unknown>)
    );
    expect(updatesOnClaimedRow.length).toBeGreaterThanOrEqual(1);
    for (const u of updatesOnClaimedRow) {
      expect(u.payload?.board_session_id).toBe(sessionFromInsert);
    }
  });

  it("records a write-rate sample for every actual sync attempt", async () => {
    seedSoccerBoard("team-rate");
    const { result } = renderHook(() => useActiveGameSync());

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await result.current.forceSync();
      });
    }

    expect(recordSyncWriteSpy).toHaveBeenCalledTimes(5);
    for (const call of recordSyncWriteSpy.mock.calls) {
      expect(call[0]).toMatchObject({
        userId: "coach-A-user",
        teamId: "team-rate",
        source: "soccer",
      });
    }
  });

  it("two hook mounts (same coach, different teams) generate distinct session ids and don't deactivate each other", async () => {
    // Coach-A is running boards for two teams in parallel tabs/windows.
    seedSoccerBoard("team-X");
    const tabX = renderHook(() => useActiveGameSync());
    await act(async () => {
      await tabX.result.current.forceSync();
    });

    // Now switch storage to team-Y as if another tab was driving it.
    seedSoccerBoard("team-Y");
    const tabY = renderHook(() => useActiveGameSync());
    await act(async () => {
      await tabY.result.current.forceSync();
    });

    const inserts = insertWrites();
    expect(inserts.length).toBe(2);
    const sessionX = inserts[0].payload?.board_session_id as string;
    const sessionY = inserts[1].payload?.board_session_id as string;
    expect(sessionX).toBeTruthy();
    expect(sessionY).toBeTruthy();
    expect(sessionX).not.toBe(sessionY);

    // Critically: row for team-X must STILL be active. The (user, team)-
    // scoped deactivation filter must not have turned it off when team-Y's
    // sync ran.
    const rowX = fakeRows.find((r) => r.team_id === "team-X");
    const rowY = fakeRows.find((r) => r.team_id === "team-Y");
    expect(rowX?.is_active).toBe(true);
    expect(rowY?.is_active).toBe(true);

    // Every "deactivate other rows" UPDATE must be scoped to the SAME team
    // that's syncing — never cross-team. (A scoped update against team-X is
    // harmless if no other team-X row exists, but a deactivation that omits
    // the team filter would silently kill the other team's board.)
    const deactivationUpdates = updateWrites().filter(
      (u) => (u.payload as Record<string, unknown>)?.is_active === false
    );
    for (const u of deactivationUpdates) {
      const f = u.filters as Record<string, unknown>;
      // Deactivation is intentionally team-scoped (shared-session model):
      // a team_id filter must be present, but user_id must NOT be a filter
      // — otherwise a stale row owned by a different controller (admin vs
      // subs-manager) would survive and trip the unique constraint.
      expect(typeof f.team_id === "string" || f.team_id === null).toBe(true);
    }
    // Critically: no deactivation update may target team-X with the
    // current-row exclusion pointing at a team-Y row id, and vice versa.
    const crossTeamDeactivation = deactivationUpdates.find((u) => {
      const f = u.filters as Record<string, unknown>;
      const excludeId = f.__neq__id as string | undefined;
      if (!excludeId) return false;
      const targetTeam = f.team_id;
      const excludedRow = fakeRows.find((r) => r.id === excludeId);
      // Excluded row's team should match the deactivation's team filter.
      return excludedRow !== undefined && excludedRow.team_id !== targetTeam;
    });
    expect(crossTeamDeactivation).toBeUndefined();
  });

  it("scopes deactivateOtherActiveGames to (user, team) — never wipes other teams", async () => {
    // Pre-existing rows: same user, three teams, all active.
    fakeRows.push(
      {
        id: "row-team-A",
        user_id: "coach-A-user",
        team_id: "team-A",
        is_active: true,
        updated_at: new Date(Date.now() - 30_000).toISOString(),
      },
      {
        id: "row-team-B",
        user_id: "coach-A-user",
        team_id: "team-B",
        is_active: true,
        updated_at: new Date(Date.now() - 20_000).toISOString(),
      },
      {
        id: "row-team-C",
        user_id: "coach-A-user",
        team_id: "team-C",
        is_active: true,
        updated_at: new Date(Date.now() - 10_000).toISOString(),
      }
    );

    seedSoccerBoard("team-A");
    const { result } = renderHook(() => useActiveGameSync());
    await act(async () => {
      await result.current.forceSync();
    });
    await act(async () => {
      await result.current.forceSync();
    });

    // After syncing team-A, teams B and C must STILL be active.
    expect(fakeRows.find((r) => r.id === "row-team-B")?.is_active).toBe(true);
    expect(fakeRows.find((r) => r.id === "row-team-C")?.is_active).toBe(true);
    expect(fakeRows.find((r) => r.id === "row-team-A")?.is_active).toBe(true);
  });
});
