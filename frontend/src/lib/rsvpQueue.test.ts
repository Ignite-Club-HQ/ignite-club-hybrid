import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock supabase client BEFORE importing rsvpQueue
type MockResult = { error: null | { code?: string; message?: string } };

const updateMock: any = vi.fn();
const insertMock: any = vi.fn();

// Chain: supabase.from("rsvps").update(...).eq(...) => Promise
// Chain: supabase.from("rsvps").insert(...) => Promise
vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: (_table: string) => ({
        update: (_vals: unknown) => ({
          eq: (_col: string, _val: unknown) => updateMock(),
        }),
        insert: (vals: unknown) => insertMock(vals),
      }),
    },
  };
});

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

describe("syncQueuedRsvps (Defect 2 - concurrency safety)", () => {
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
