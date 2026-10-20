import { describe, it, expect, beforeEach, vi } from "vitest";
import { waitFor } from "@testing-library/react";

const liveMocks = vi.hoisted(() => ({
  backend: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
  setLiveEventRsvp: vi.fn(),
  adminUpsertLiveRsvp: vi.fn(),
  setLiveMiniLeagueRsvp: vi.fn(),
  supabaseFromCalls: [] as unknown[][],
}));
const supabaseMode = liveMocks.backend === "supabase";

// Mock supabase client BEFORE importing rsvpQueue
type MockResult = { error: null | { code?: string; message?: string } };

const updateMock: any = vi.fn();
const insertMock: any = vi.fn();

// Chain: supabase.from("rsvps").update(...).eq(...) => Promise
// Chain: supabase.from("rsvps").insert(...) => Promise
vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: (...args: unknown[]) => {
        liveMocks.supabaseFromCalls.push(args);
        return {
        update: (_vals: unknown) => ({
          eq: (_col: string, _val: unknown) => updateMock(),
        }),
        insert: (vals: unknown) => insertMock(vals),
        };
      },
    },
  };
});
vi.mock("@/live/loadBackendRouting", () => ({
  isFeatureRoutedToIcp: () => liveMocks.backend === "icp",
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    liveMocks.backend === "icp" ? providers.icp(liveMocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/events", () => ({
  setLiveEventRsvp: (...args: unknown[]) => liveMocks.setLiveEventRsvp(...args),
  adminUpsertLiveRsvp: (...args: unknown[]) => liveMocks.adminUpsertLiveRsvp(...args),
  setLiveMiniLeagueRsvp: (...args: unknown[]) => liveMocks.setLiveMiniLeagueRsvp(...args),
}));

import {
  getQueuedRsvps,
  queueRsvp,
  syncQueuedRsvps,
  getQueuedRsvpCount,
  QueuedRsvp,
} from "./rsvpQueue";

const QUEUE_KEY = "ignite_rsvp_queue";

function writeRaw(value: string) {
  localStorage.setItem(QUEUE_KEY, value);
}
function readRaw(): QueuedRsvp[] {
  const raw = localStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}
function makeEntry(overrides: Partial<QueuedRsvp> = {}): QueuedRsvp {
  return {
    id: overrides.id ?? `qrsvp-${Math.random().toString(36).slice(2, 10)}`,
    eventId: overrides.eventId ?? "event-1",
    userId: overrides.userId ?? "user-1",
    childId: overrides.childId ?? null,
    miniLeaguePlayerId: overrides.miniLeaguePlayerId ?? null,
    status: overrides.status ?? "going",
    notes: overrides.notes ?? null,
    existingRsvpId: overrides.existingRsvpId ?? null,
    queuedAt: overrides.queuedAt ?? new Date().toISOString(),
    retryCount: overrides.retryCount ?? 0,
  };
}

beforeEach(() => {
  localStorage.clear();
  updateMock.mockReset();
  insertMock.mockReset();
  liveMocks.setLiveEventRsvp.mockReset();
  liveMocks.adminUpsertLiveRsvp.mockReset();
  liveMocks.setLiveMiniLeagueRsvp.mockReset();
  liveMocks.supabaseFromCalls.length = 0;
  insertMock.mockResolvedValue({ error: null });
  updateMock.mockResolvedValue({ error: null });
});

describe("getQueuedRsvps validation (Defect 1)", () => {
  it("returns empty for missing storage", () => {
    expect(getQueuedRsvps()).toEqual([]);
  });

  it("treats valid JSON with an invalid non-array shape as an empty queue", () => {
    writeRaw(JSON.stringify({ eventId: "event-1" }));
    expect(getQueuedRsvps()).toEqual([]);
  });

  it("drops invalid entries but preserves valid entries in the same array", () => {
    const good = makeEntry({ id: "good-1" });
    const bad = { id: "", eventId: "e", userId: "u", status: "going", retryCount: 0, queuedAt: "x" };
    const bad2 = { id: "x", eventId: "e", userId: "u", status: "unknown", retryCount: 0, queuedAt: "x" };
    const bad3 = { id: "y", eventId: "e", userId: "u", status: "going", retryCount: -1, queuedAt: "x" };
    writeRaw(JSON.stringify([good, bad, bad2, bad3, null, "string"]));
    const out = getQueuedRsvps();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("good-1");
  });

  it("does not throw when local storage is malformed", () => {
    writeRaw("{not-json");
    expect(() => getQueuedRsvps()).not.toThrow();
    expect(getQueuedRsvps()).toEqual([]);
  });
});

describe("queueRsvp identity semantics", () => {
  it("replaces a pending response for the same attendee/event identity", () => {
    queueRsvp({ eventId: "e1", userId: "u1", status: "going" });
    queueRsvp({ eventId: "e1", userId: "u1", status: "not_going" });
    const q = getQueuedRsvps();
    expect(q).toHaveLength(1);
    expect(q[0].status).toBe("not_going");
  });

  it("keeps self/child/mini-league responses distinct", () => {
    queueRsvp({ eventId: "e1", userId: "u1", status: "going" });
    queueRsvp({ eventId: "e1", userId: "u1", childId: "c1", status: "going" });
    queueRsvp({ eventId: "e1", userId: "u1", miniLeaguePlayerId: "p1", status: "going" });
    expect(getQueuedRsvpCount()).toBe(3);
  });
});

describe.runIf(supabaseMode)("syncQueuedRsvps (Defect 2 - concurrency safety)", () => {
  it("empty queue performs no mutations", async () => {
    const res = await syncQueuedRsvps();
    expect(res).toEqual({ synced: 0, failed: 0 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("removes successfully synced entries and preserves notes/source", async () => {
    queueRsvp({ eventId: "e1", userId: "u1", status: "going", notes: "hello" });
    const res = await syncQueuedRsvps();
    expect(res).toEqual({ synced: 1, failed: 0 });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      event_id: "e1",
      user_id: "u1",
      status: "going",
      notes: "hello",
      source: "user",
    });
    expect(getQueuedRsvps()).toEqual([]);
  });

  it("preserves a new RSVP queued while an earlier background sync is in flight", async () => {
    queueRsvp({ eventId: "e1", userId: "u1", status: "going" });

    // Insert becomes slow; while it is awaiting, a new entry gets queued
    let resolveInsert: (v: MockResult) => void;
    insertMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInsert = resolve;
        })
    );

    const syncPromise = syncQueuedRsvps();
    // Now, during sync, add a new entry for a different event
    queueRsvp({ eventId: "e2", userId: "u1", status: "maybe" });
    // Complete the in-flight insert
    resolveInsert!({ error: null });
    const res = await syncPromise;

    expect(res.synced).toBe(1);
    const remaining = getQueuedRsvps();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].eventId).toBe("e2");
    expect(remaining[0].status).toBe("maybe");
  });

  it("an in-flight older RSVP must not delete a newer replacement for the same attendee/event", async () => {
    queueRsvp({ eventId: "e1", userId: "u1", status: "going" });

    let resolveInsert: (v: MockResult) => void;
    insertMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInsert = resolve;
        })
    );

    const syncPromise = syncQueuedRsvps();
    // Same identity, new response replaces older one (gets new id)
    queueRsvp({ eventId: "e1", userId: "u1", status: "not_going" });
    resolveInsert!({ error: null });
    await syncPromise;

    const remaining = getQueuedRsvps();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("not_going");
  });

  it("a failed snapshot entry increments only its own retry count; other entries unaffected", async () => {
    queueRsvp({ eventId: "e1", userId: "u1", status: "going" });
    queueRsvp({ eventId: "e2", userId: "u1", status: "going" });

    insertMock
      .mockResolvedValueOnce({ error: { message: "fail" } })
      .mockResolvedValueOnce({ error: null });

    const res = await syncQueuedRsvps();
    expect(res.synced).toBe(1);
    expect(res.failed).toBe(0);
    const remaining = getQueuedRsvps();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].eventId).toBe("e1");
    expect(remaining[0].retryCount).toBe(1);
  });

  it("drops and reports the third failure", async () => {
    const entry = makeEntry({ id: "keep", eventId: "e1", userId: "u1", retryCount: 2 });
    writeRaw(JSON.stringify([entry]));
    insertMock.mockResolvedValueOnce({ error: { message: "fail" } });

    const res = await syncQueuedRsvps();
    expect(res).toEqual({ synced: 0, failed: 1 });
    expect(getQueuedRsvps()).toEqual([]);
  });

  it("PGRST116 on update falls back to insert and counts as success", async () => {
    const entry = makeEntry({ existingRsvpId: "rsvp-abc" });
    writeRaw(JSON.stringify([entry]));
    updateMock.mockResolvedValueOnce({ error: { code: "PGRST116" } });
    insertMock.mockResolvedValueOnce({ error: null });

    const res = await syncQueuedRsvps();
    expect(res).toEqual({ synced: 1, failed: 0 });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(getQueuedRsvps()).toEqual([]);
  });

  it("a current entry not present in the snapshot is preserved byte-for-byte", async () => {
    queueRsvp({ eventId: "e1", userId: "u1", status: "going" });

    let resolveInsert: (v: MockResult) => void;
    insertMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInsert = resolve;
        })
    );

    const syncPromise = syncQueuedRsvps();
    const injected = makeEntry({ id: "injected-1", eventId: "e9", notes: "keep", retryCount: 2 });
    const current = getQueuedRsvps();
    writeRaw(JSON.stringify([...current, injected]));

    resolveInsert!({ error: null });
    await syncPromise;

    const remaining = getQueuedRsvps();
    const found = remaining.find((r) => r.id === "injected-1");
    expect(found).toBeDefined();
    expect(found).toEqual(injected);
  });

  it("two simultaneous calls to syncQueuedRsvps do not double-submit the same entries", async () => {
    queueRsvp({ eventId: "e1", userId: "u1", status: "going" });

    let resolveInsert: (v: MockResult) => void;
    insertMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInsert = resolve;
        })
    );

    const p1 = syncQueuedRsvps();
    const p2 = syncQueuedRsvps();
    resolveInsert!({ error: null });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(getQueuedRsvps()).toEqual([]);
  });
});

describe.runIf(!supabaseMode)("syncQueuedRsvps ICP adapter", () => {
  beforeEach(() => {
    liveMocks.setLiveEventRsvp.mockReset().mockResolvedValue(undefined);
    liveMocks.adminUpsertLiveRsvp.mockReset().mockResolvedValue(undefined);
    liveMocks.setLiveMiniLeagueRsvp.mockReset().mockResolvedValue(undefined);
  });

  it("performs no canister calls for an empty queue", async () => {
    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 0, failed: 0 });
    expect(liveMocks.setLiveEventRsvp).not.toHaveBeenCalled();
    expect(liveMocks.adminUpsertLiveRsvp).not.toHaveBeenCalled();
    expect(liveMocks.setLiveMiniLeagueRsvp).not.toHaveBeenCalled();
  });

  it("syncs self and child RSVPs through events_domain without Supabase writes", async () => {
    queueRsvp({ eventId: "event-self", userId: "principal-1", status: "going" });
    queueRsvp({ eventId: "event-child", userId: "principal-1", childId: "child-1", status: "maybe", notes: "late" });

    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 2, failed: 0 });
    expect(liveMocks.setLiveEventRsvp).toHaveBeenCalledWith(
      liveMocks.context, "event-self", "principal-1", "going",
    );
    expect(liveMocks.adminUpsertLiveRsvp).toHaveBeenCalledWith(
      liveMocks.context, "event-child", "principal-1", "maybe", { childId: "child-1", notes: "late" },
    );
    expect(getQueuedRsvps()).toEqual([]);
    expect(liveMocks.supabaseFromCalls).toEqual([]);
  });

  it("syncs mini-league-player RSVPs on-chain without Supabase fallback", async () => {
    queueRsvp({ eventId: "event-1", userId: "principal-1", miniLeaguePlayerId: "player-1", status: "going" });

    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(getQueuedRsvps()).toEqual([]);
    expect(liveMocks.setLiveMiniLeagueRsvp).toHaveBeenCalledWith(liveMocks.context, "event-1", { mini_league_player: "player-1" }, "going");
    expect(liveMocks.supabaseFromCalls).toEqual([]);
    expect(liveMocks.setLiveEventRsvp).not.toHaveBeenCalled();
    expect(liveMocks.adminUpsertLiveRsvp).not.toHaveBeenCalled();
  });

  it("preserves a new RSVP queued while a canister sync is in flight", async () => {
    queueRsvp({ eventId: "event-1", userId: "principal-1", status: "going" });
    let resolveWrite!: () => void;
    liveMocks.setLiveEventRsvp.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveWrite = resolve;
    }));

    const syncing = syncQueuedRsvps();
    await waitFor(() => expect(resolveWrite).toBeTypeOf("function"));
    queueRsvp({ eventId: "event-2", userId: "principal-1", status: "maybe" });
    resolveWrite();

    await expect(syncing).resolves.toEqual({ synced: 1, failed: 0 });
    expect(getQueuedRsvps()).toEqual([expect.objectContaining({ eventId: "event-2", status: "maybe" })]);
    expect(liveMocks.supabaseFromCalls).toEqual([]);
  });

  it("increments only a failed canister RSVP while removing successful entries", async () => {
    queueRsvp({ eventId: "event-fail", userId: "principal-1", status: "going" });
    queueRsvp({ eventId: "event-success", userId: "principal-1", status: "going" });
    liveMocks.setLiveEventRsvp.mockRejectedValueOnce(new Error("temporary canister failure"));

    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(getQueuedRsvps()).toEqual([
      expect.objectContaining({ eventId: "event-fail", retryCount: 1 }),
    ]);
    expect(liveMocks.supabaseFromCalls).toEqual([]);
  });

  it("shares one in-flight canister replay between simultaneous sync calls", async () => {
    queueRsvp({ eventId: "event-1", userId: "principal-1", status: "going" });
    let resolveWrite!: () => void;
    liveMocks.setLiveEventRsvp.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveWrite = resolve;
    }));

    const first = syncQueuedRsvps();
    const second = syncQueuedRsvps();
    await waitFor(() => expect(resolveWrite).toBeTypeOf("function"));
    resolveWrite();
    const results = await Promise.all([first, second]);

    expect(results).toEqual([{ synced: 1, failed: 0 }, { synced: 1, failed: 0 }]);
    expect(liveMocks.setLiveEventRsvp).toHaveBeenCalledTimes(1);
    expect(getQueuedRsvps()).toEqual([]);
    expect(liveMocks.supabaseFromCalls).toEqual([]);
  });
});
