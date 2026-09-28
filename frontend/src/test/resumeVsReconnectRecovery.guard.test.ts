import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression guard for the resume-freeze defect.
 *
 * Root cause (commit 0ee10f109 / d88010b7c, 2026-07-27): the reconnect
 * recovery path called `refetchQueries({ type: 'active' })` on EVERY resume,
 * not just on a genuine offline→online transition. A heavy page (Inbox mounts
 * ~25-30 active queries) then fired every query at once into the browser's
 * ~6-connection-per-origin pool. If any slot was held by a zombie socket left
 * over from the suspend, the rest queued behind it forever and the page sat on
 * skeletons until the user force-quit the app.
 *
 * The invariant these tests protect:
 *   - RESUME (visibilitychange → visible)  => MUST NOT blanket-refetch.
 *   - RECONNECT (window 'online')          => MAY blanket-refetch, but DRIPPED.
 */

type MockQuery = { queryKey: unknown[]; state: { status: string; fetchStatus: string } };

function makeQueryClient(activeCount: number) {
  const active: MockQuery[] = Array.from({ length: activeCount }, (_, i) => ({
    queryKey: ["q", i],
    state: { status: "success", fetchStatus: "idle" },
  }));
  return {
    refetchQueries: vi.fn(),
    invalidateQueries: vi.fn(),
    getQueryCache: () => ({
      // no broken queries — isolates the blanket-refetch behaviour
      getAll: () => [],
      findAll: () => active,
    }),
  };
}

async function install(client: unknown) {
  vi.resetModules();
  const mod = await import("@/lib/webReconnectInvalidator");
  return mod.installWebReconnectInvalidator(client as never);
}

describe("webReconnectInvalidator resume/reconnect separation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does NOT blanket-refetch active queries on a plain resume", async () => {
    const qc = makeQueryClient(30);
    await install(qc);

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(2000);

    expect(qc.refetchQueries).not.toHaveBeenCalled();
  });

  it("DOES refetch active queries on a genuine reconnect", async () => {
    const qc = makeQueryClient(30);
    await install(qc);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(2000);

    expect(qc.refetchQueries).toHaveBeenCalledTimes(30);
  });

  it("drips the reconnect refetch instead of firing it in one tick", async () => {
    const qc = makeQueryClient(30);
    await install(qc);

    window.dispatchEvent(new Event("online"));

    // First batch only: must not exceed the ~6-connection pool immediately.
    await vi.advanceTimersByTimeAsync(0);
    const firstTick = qc.refetchQueries.mock.calls.length;
    expect(firstTick).toBeLessThanOrEqual(6);
    expect(firstTick).toBeGreaterThan(0);

    // Remainder arrives over subsequent batches.
    await vi.advanceTimersByTimeAsync(2000);
    expect(qc.refetchQueries).toHaveBeenCalledTimes(30);
  });

  it("still revives genuinely broken queries on resume", async () => {
    const broken: MockQuery[] = [
      { queryKey: ["broken"], state: { status: "error", fetchStatus: "idle" } },
    ];
    const qc = {
      refetchQueries: vi.fn(),
      invalidateQueries: vi.fn(),
      getQueryCache: () => ({ getAll: () => broken, findAll: () => [] }),
    };
    await install(qc);

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(2000);

    // Revived via invalidate, without the blanket refetch.
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["broken"],
      exact: true,
    });
    expect(qc.refetchQueries).not.toHaveBeenCalled();
  });
});
