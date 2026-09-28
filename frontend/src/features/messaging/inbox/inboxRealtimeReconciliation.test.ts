import { describe, it, expect, vi } from "vitest";
import {
  createInboxRealtimeCoordinator,
  createInboxPreviewWatermarks,
  type InboxRealtimeEvent,
} from "@/features/messaging/inbox/inboxRealtimeReconciliation";

const insert = (id: string, table = "team_messages"): InboxRealtimeEvent => ({
  table,
  kind: "insert",
  payload: { new: { id, team_id: "t1", text: `msg ${id}`, created_at: "2026-01-01T00:00:00Z" } },
});

describe("inbox realtime coordinator", () => {
  it("buffers events that arrive before authorization is ready, then applies on flush", () => {
    let ready = false;
    const applier = vi.fn();
    const c = createInboxRealtimeCoordinator({ isReady: () => ready });
    c.setApplier(applier);

    c.dispatch(insert("a"));
    expect(applier).not.toHaveBeenCalled();
    expect(c.pendingCount()).toBe(1);

    ready = true;
    expect(c.attemptFlush()).toBe(1);
    expect(applier).toHaveBeenCalledTimes(1);
  });

  it("flushes when authorization became ready BEFORE the applier was installed", () => {
    let ready = false;
    const applier = vi.fn();
    const c = createInboxRealtimeCoordinator({ isReady: () => ready });

    c.dispatch(insert("a")); // no applier yet
    ready = true;
    c.attemptFlush(); // no applier -> no-op
    expect(applier).not.toHaveBeenCalled();

    c.setApplier(applier); // installing flushes
    expect(applier).toHaveBeenCalledTimes(1);
    expect(c.pendingCount()).toBe(0);
  });

  it("applies immediately when everything is already ready", () => {
    const applier = vi.fn();
    const c = createInboxRealtimeCoordinator({ isReady: () => true });
    c.setApplier(applier);
    c.dispatch(insert("a"));
    expect(applier).toHaveBeenCalledTimes(1);
    expect(c.pendingCount()).toBe(0);
  });

  it("applies duplicate delivery of the same message exactly once", () => {
    const applier = vi.fn();
    const c = createInboxRealtimeCoordinator({ isReady: () => true });
    c.setApplier(applier);
    c.dispatch(insert("a"));
    c.dispatch(insert("a"));
    expect(applier).toHaveBeenCalledTimes(1);
  });

  it("treats the same row in a different table as a distinct event", () => {
    const applier = vi.fn();
    const c = createInboxRealtimeCoordinator({ isReady: () => true });
    c.setApplier(applier);
    c.dispatch(insert("a", "team_messages"));
    c.dispatch(insert("a", "club_messages"));
    expect(applier).toHaveBeenCalledTimes(2);
  });

  it("applies each edit revision once", () => {
    const applier = vi.fn();
    const c = createInboxRealtimeCoordinator({ isReady: () => true });
    c.setApplier(applier);
    const edit = (rev: string): InboxRealtimeEvent => ({
      table: "team_messages",
      kind: "edit",
      payload: { new: { id: "a", edited_at: rev, text: rev } },
    });
    c.dispatch(edit("r1"));
    c.dispatch(edit("r1"));
    c.dispatch(edit("r2"));
    expect(applier).toHaveBeenCalledTimes(2);
  });

  it("keeps the buffer across harmless re-renders (repeated flush attempts)", () => {
    let ready = false;
    const applier = vi.fn();
    const c = createInboxRealtimeCoordinator({ isReady: () => ready });
    c.setApplier(applier);
    c.dispatch(insert("a"));
    c.attemptFlush();
    c.attemptFlush();
    expect(c.pendingCount()).toBe(1);
    ready = true;
    c.attemptFlush();
    expect(applier).toHaveBeenCalledTimes(1);
  });

  it("clear() drops pending events (revocation / sign-out / user switch)", () => {
    let ready = false;
    const applier = vi.fn();
    const c = createInboxRealtimeCoordinator({ isReady: () => ready });
    c.setApplier(applier);
    c.dispatch(insert("a"));
    c.clear();
    ready = true;
    expect(c.attemptFlush()).toBe(0);
    expect(applier).not.toHaveBeenCalled();
  });

  it("relies on the applier for authorization, so unauthorized events are discarded at flush", () => {
    let ready = false;
    const authorizedTeams = new Set(["t1"]);
    const applied: string[] = [];
    const c = createInboxRealtimeCoordinator({ isReady: () => ready });
    c.setApplier((e) => {
      if (!authorizedTeams.has(e.payload.new.team_id)) return;
      applied.push(e.payload.new.id);
    });

    c.dispatch(insert("a"));
    c.dispatch({
      table: "team_messages",
      kind: "insert",
      payload: { new: { id: "b", team_id: "other-club-team", created_at: "2026-01-01T00:00:00Z" } },
    });
    ready = true;
    c.attemptFlush();
    expect(applied).toEqual(["a"]);
  });

  it("bounds the pending queue", () => {
    const c = createInboxRealtimeCoordinator({ isReady: () => false, maxPending: 3 });
    for (let i = 0; i < 10; i += 1) c.dispatch(insert(`m${i}`));
    expect(c.pendingCount()).toBe(3);
  });
});

describe("inbox preview watermarks", () => {
  const preview = (created_at: string, text: string) => ({ created_at, text, author: "Sam" });

  it("passes authoritative data through untouched when there is no watermark", () => {
    const w = createInboxPreviewWatermarks();
    const map = { t1: preview("2026-01-01T00:00:00Z", "old") };
    expect(w.reconcile("team", map)).toBe(map);
  });

  it("keeps a newer realtime preview when a stale in-flight response resolves after it", () => {
    const w = createInboxPreviewWatermarks();
    w.note("team:t1", preview("2026-01-02T00:00:00Z", "new message"));
    const stale = { t1: preview("2026-01-01T00:00:00Z", "old message") };
    expect(w.reconcile("team", stale).t1.text).toBe("new message");
  });

  it("keeps a newer realtime preview when the stale response omits the scope entirely", () => {
    const w = createInboxPreviewWatermarks();
    w.note("team:t1", preview("2026-01-02T00:00:00Z", "new message"));
    expect(w.reconcile("team", {}).t1.text).toBe("new message");
    expect(w.reconcile("team", undefined).t1.text).toBe("new message");
  });

  it("lets a newer authoritative response supersede the realtime preview", () => {
    const w = createInboxPreviewWatermarks();
    w.note("team:t1", preview("2026-01-02T00:00:00Z", "realtime"));
    const fresh = { t1: preview("2026-01-03T00:00:00Z", "authoritative") };
    expect(w.reconcile("team", fresh).t1.text).toBe("authoritative");
  });

  it("does not regress a watermark when an older realtime event is noted later", () => {
    const w = createInboxPreviewWatermarks();
    w.note("team:t1", preview("2026-01-02T00:00:00Z", "newer"));
    w.note("team:t1", preview("2026-01-01T00:00:00Z", "older"));
    expect(w.reconcile("team", {}).t1.text).toBe("newer");
  });

  it("scopes watermarks by kind so clubs never leak into teams", () => {
    const w = createInboxPreviewWatermarks();
    w.note("club:c1", preview("2026-01-02T00:00:00Z", "club msg"));
    expect(w.reconcile("team", {})).toEqual({});
    expect(w.reconcile("club", {}).c1.text).toBe("club msg");
  });

  it("borrows an author name the authoritative response already resolved", () => {
    const w = createInboxPreviewWatermarks();
    w.note("team:t1", { created_at: "2026-01-02T00:00:00Z", text: "hi", author: "" });
    const merged = w.reconcile("team", {
      t1: { created_at: "2026-01-01T00:00:00Z", text: "old", author: "Alex" },
    });
    expect(merged.t1).toMatchObject({ text: "hi", author: "Alex" });
  });

  it("clear() removes all watermarks (sign-out / user switch)", () => {
    const w = createInboxPreviewWatermarks();
    w.note("team:t1", preview("2026-01-02T00:00:00Z", "new"));
    w.clear();
    expect(w.size()).toBe(0);
    expect(w.reconcile("team", {})).toEqual({});
  });
});
