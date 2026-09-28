/**
 * Presence lifecycle regression suite.
 *
 * Covers:
 *  1. Duplicate user IDs must not inflate online counts.
 *  2. Delayed CHANNEL_ERROR / TIMED_OUT / CLOSED from an obsolete channel must
 *     not tear down the healthy replacement channel or schedule a reconnect.
 *  3. Delayed SUBSCRIBED from an obsolete channel must not track, RPC, or
 *     install a heartbeat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type StatusCb = (status: string) => void | Promise<void>;

interface FakeChannel {
  name: string;
  key: string;
  handlers: Record<string, (payload: any) => void>;
  statusCb: StatusCb | null;
  tracked: any[];
  untracked: number;
  removed: boolean;
  presence: Record<string, Array<{ user_id?: string }>>;
  on: (type: string, filter: any, cb: (p: any) => void) => FakeChannel;
  subscribe: (cb: StatusCb) => FakeChannel;
  track: (payload: any) => Promise<void>;
  untrack: () => Promise<void>;
  presenceState: () => Record<string, Array<{ user_id?: string }>>;
}

const channels: FakeChannel[] = [];
const rpcCalls: string[] = [];

function makeChannel(name: string, opts?: any): FakeChannel {
  const ch: FakeChannel = {
    name,
    key: opts?.config?.presence?.key ?? "",
    handlers: {},
    statusCb: null,
    tracked: [],
    untracked: 0,
    removed: false,
    presence: {},
    on(type, filter, cb) {
      ch.handlers[`${type}:${filter?.event}`] = cb;
      return ch;
    },
    subscribe(cb) {
      ch.statusCb = cb;
      return ch;
    },
    async track(payload) {
      ch.tracked.push(payload);
      ch.presence[ch.key] = [{ user_id: payload.user_id }];
    },
    async untrack() {
      ch.untracked++;
    },
    presenceState: () => ch.presence,
  };
  channels.push(ch);
  return ch;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string, opts?: any) => makeChannel(name, opts),
    removeChannel: async (ch: FakeChannel) => {
      ch.removed = true;
    },
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      return { data: null, error: null };
    },
  },
}));

let mod: typeof import("./useUserPresence");

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  channels.length = 0;
  rpcCalls.length = 0;
  mod = await import("./useUserPresence");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOnlineCount — unique counting", () => {
  const online = (ids: string[]) => {
    const ch = channels[0];
    ch.presence = Object.fromEntries(ids.map((id) => [id, [{ user_id: id }]]));
    act(() => {
      ch.handlers["presence:sync"]?.({});
    });
  };

  it("counts unique people and excludes the current user", async () => {
    renderHook(() => mod.useTrackPresence("u1"));
    await flush();
    const input = ["u1", "u2", "u2", "u3"];
    const { result } = renderHook(() => mod.useOnlineCount(input, "u1"));
    online(["u1", "u2"]);
    expect(result.current).toBe(1);
    // caller's array is not mutated
    expect(input).toEqual(["u1", "u2", "u2", "u3"]);
  });

  it("counts a duplicated single ID once", async () => {
    renderHook(() => mod.useTrackPresence("u1"));
    await flush();
    const { result } = renderHook(() => mod.useOnlineCount(["u2", "u2"]));
    online(["u2"]);
    expect(result.current).toBe(1);
  });

  it("never counts excludeUserId even when duplicated", async () => {
    renderHook(() => mod.useTrackPresence("u1"));
    await flush();
    const { result } = renderHook(() =>
      mod.useOnlineCount(["u1", "u1", "u2"], "u1"),
    );
    online(["u1", "u2"]);
    expect(result.current).toBe(1);
  });

  it("ignores null/empty/malformed IDs", async () => {
    renderHook(() => mod.useTrackPresence("u1"));
    await flush();
    const { result } = renderHook(() =>
      mod.useOnlineCount([null as any, "", "  ", "u2", undefined as any]),
    );
    online(["u2"]);
    expect(result.current).toBe(1);
  });

  it("returns the same count for reordered input", async () => {
    renderHook(() => mod.useTrackPresence("u1"));
    await flush();
    const a = renderHook(() => mod.useOnlineCount(["u2", "u3", "u2"], "u1"));
    const b = renderHook(() => mod.useOnlineCount(["u3", "u2", "u3"], "u1"));
    online(["u2", "u3"]);
    expect(a.result.current).toBe(2);
    expect(b.result.current).toBe(b.result.current);
    expect(a.result.current).toBe(b.result.current);
  });

  it("multiple consumers share one physical channel", async () => {
    renderHook(() => mod.useTrackPresence("u1"));
    renderHook(() => mod.useTrackPresence("u1"));
    await flush();
    expect(channels.length).toBe(1);
  });
});

describe("presence channel ownership", () => {
  const subscribeActive = async () => {
    const ch = channels[channels.length - 1];
    await act(async () => {
      await ch.statusCb?.("SUBSCRIBED");
    });
    return ch;
  };

  it("re-tracks on a second SUBSCRIBED but keeps exactly one heartbeat timer", async () => {
    renderHook(() => mod.useTrackPresence("u1"));
    await flush();
    const ch = await subscribeActive();
    await subscribeActive();
    expect(ch.tracked.length).toBe(2);

    const before = ch.tracked.length;
    await act(async () => {
      vi.advanceTimersByTime(25_000);
      await Promise.resolve();
    });
    // Exactly one heartbeat tick, not two.
    expect(ch.tracked.length).toBe(before + 1);
  });

  it("coalesces repeated active-channel errors into one replacement channel", async () => {
    renderHook(() => mod.useTrackPresence("u1"));
    await flush();
    const ch = channels[0];
    await act(async () => {
      await ch.statusCb?.("CHANNEL_ERROR");
      await ch.statusCb?.("TIMED_OUT");
      await ch.statusCb?.("CLOSED");
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(channels.length).toBe(2);
  });

  it("ignores error statuses from an obsolete channel", async () => {
    const hook = renderHook(({ id }) => mod.useTrackPresence(id), {
      initialProps: { id: "u1" },
    });
    await flush();
    const oldCh = channels[0];
    await subscribeActive();

    // Switch users → replacement channel.
    hook.rerender({ id: "u2" });
    await flush();
    expect(channels.length).toBe(2);
    const newCh = channels[1];
    await act(async () => {
      await newCh.statusCb?.("SUBSCRIBED");
    });
    const trackedBefore = newCh.tracked.length;

    // Delayed error from the obsolete channel.
    await act(async () => {
      await oldCh.statusCb?.("CHANNEL_ERROR");
      await oldCh.statusCb?.("TIMED_OUT");
      await oldCh.statusCb?.("CLOSED");
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    // No reconnect, no extra channel, replacement untouched.
    expect(channels.length).toBe(2);
    expect(newCh.removed).toBe(false);

    // Heartbeat for the active channel still alive.
    await act(async () => {
      vi.advanceTimersByTime(25_000);
      await Promise.resolve();
    });
    expect(newCh.tracked.length).toBe(trackedBefore + 1);
    expect(newCh.tracked[0].user_id).toBe("u2");
  });

  it("ignores a delayed SUBSCRIBED from an obsolete channel", async () => {
    const hook = renderHook(({ id }) => mod.useTrackPresence(id), {
      initialProps: { id: "u1" },
    });
    await flush();
    const oldCh = channels[0];

    hook.rerender({ id: "u2" });
    await flush();
    const newCh = channels[1];
    await act(async () => {
      await newCh.statusCb?.("SUBSCRIBED");
    });
    const rpcBefore = rpcCalls.length;

    await act(async () => {
      await oldCh.statusCb?.("SUBSCRIBED");
    });

    // No tracking, no RPC, no heartbeat installed by the obsolete callback.
    expect(oldCh.tracked.length).toBe(0);
    expect(rpcCalls.length).toBe(rpcBefore);

    await act(async () => {
      vi.advanceTimersByTime(25_000);
      await Promise.resolve();
    });
    expect(oldCh.tracked.length).toBe(0);
    expect(newCh.tracked.length).toBe(2); // initial + one heartbeat
  });

  it("signing out cancels a pending reconnect and removes the channel", async () => {
    const hook = renderHook(
      ({ id }: { id: string | null }) => mod.useTrackPresence(id),
      { initialProps: { id: "u1" as string | null } },
    );
    await flush();
    const ch = channels[0];
    await act(async () => {
      await ch.statusCb?.("CHANNEL_ERROR");
    });

    hook.rerender({ id: null });
    await flush();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(channels.length).toBe(1);
    expect(ch.removed).toBe(true);
  });

  it("switching users removes the old channel before tracking the new user", async () => {
    const hook = renderHook(({ id }) => mod.useTrackPresence(id), {
      initialProps: { id: "u1" },
    });
    await flush();
    const oldCh = channels[0];
    await act(async () => {
      await oldCh.statusCb?.("SUBSCRIBED");
    });

    hook.rerender({ id: "u2" });
    await flush();
    const newCh = channels[1];
    await act(async () => {
      await newCh.statusCb?.("SUBSCRIBED");
    });

    expect(oldCh.removed).toBe(true);
    expect(newCh.tracked[0].user_id).toBe("u2");
  });
});
