import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  createInboxRealtimeCoordinator,
  type InboxRealtimeEvent,
} from "@/features/messaging/inbox/inboxRealtimeReconciliation";

const src = readFileSync("src/pages/MessagesPage.tsx", "utf8");
const coordinatorSrc = readFileSync(
  "src/features/messaging/inbox/inboxRealtimeReconciliation.ts",
  "utf8",
);

// Isolate the native lightweight realtime effect.
const nativeBlock = src.slice(src.indexOf("Native-only: lightweight realtime"));

describe("native inbox realtime authorization-hydration buffer", () => {
  it("routes native events through the buffering coordinator", () => {
    expect(src).toContain("nativeInboxCoordinator");
    expect(nativeBlock).toContain("nativeInboxCoordinator.dispatch({ table, payload, kind })");
    expect(nativeBlock).toContain("nativeInboxCoordinator.setApplier(applyEvent)");
  });

  it("gates the coordinator on authorized scopes being ready", () => {
    expect(src).toContain('isReady: () => authStatusRef.current === "ready"');
  });

  it("bounds the buffer, dropping the oldest first", () => {
    expect(coordinatorSrc).toContain("options.maxPending ?? 50");
    expect(coordinatorSrc).toContain("pending.splice(0, pending.length - maxPending)");
  });

  it("replays only after status becomes ready and discards on failure", () => {
    expect(src).toContain('if (authScopes.status === "ready") {');
    expect(src).toContain("nativeInboxCoordinator.attemptFlush()");
    expect(src).toContain('if (authScopes.status === "failed") {');
    expect(src).toContain("nativeInboxCoordinator.clear()");
  });

  it("re-runs the fail-closed authorization check on replay", () => {
    // Replay goes through the same handlers map, which starts every branch
    // with isAuthorized(...)/status checks.
    expect(nativeBlock).toContain("handlers[event.table]?.(event.payload)");
    for (const kind of ["'team'", "'club'", "'group'", "'dm'"]) {
      expect(nativeBlock).toContain(`isAuthorized(${kind}`);
    }
    expect(nativeBlock).toContain("if (authStatusRef.current !== 'ready') return;");
  });

  it("deduplicates replayed events by immutable event identity", () => {
    const applier = vi_fnCounter();
    const c = createInboxRealtimeCoordinator({ isReady: () => true });
    c.setApplier(applier.fn);
    const event: InboxRealtimeEvent = {
      table: "team_messages",
      kind: "insert",
      payload: { new: { id: "m1", team_id: "t1", created_at: "2026-01-01T00:00:00Z" } },
    };
    c.dispatch(event);
    c.dispatch(event);
    expect(applier.count).toBe(1);
  });

  it("flushes regardless of which side of the race lands last", () => {
    // Applier installed after readiness.
    let ready = false;
    const a = vi_fnCounter();
    const c1 = createInboxRealtimeCoordinator({ isReady: () => ready });
    c1.dispatch({ table: "team_messages", kind: "insert", payload: { new: { id: "1" } } });
    ready = true;
    c1.setApplier(a.fn);
    expect(a.count).toBe(1);

    // Readiness after applier installed.
    let ready2 = false;
    const b = vi_fnCounter();
    const c2 = createInboxRealtimeCoordinator({ isReady: () => ready2 });
    c2.setApplier(b.fn);
    c2.dispatch({ table: "team_messages", kind: "insert", payload: { new: { id: "1" } } });
    expect(b.count).toBe(0);
    ready2 = true;
    c2.attemptFlush();
    expect(b.count).toBe(1);
  });

  it("clears the buffer on cleanup / user change / sign-out", () => {
    expect(nativeBlock).toContain("nativeInboxCoordinator.setApplier(null)");
    expect(nativeBlock).toContain("nativeInboxCoordinator.clear()");
    expect(src).toContain("Sign-out / user switch");
  });

  it("keeps native behaviour invalidation-free on the realtime hot path", () => {
    expect(nativeBlock).not.toContain("invalidateQueries");
    expect(nativeBlock).toContain("setQueryData");
  });

  it("preserves the separate web coordinator and channel", () => {
    expect(src).toContain("webInboxCoordinator");
    expect(src).toContain("messages-inbox-${user.id}");
  });
});

function vi_fnCounter() {
  const state = { count: 0, fn: (_e: InboxRealtimeEvent) => {} };
  state.fn = () => {
    state.count += 1;
  };
  return state;
}
