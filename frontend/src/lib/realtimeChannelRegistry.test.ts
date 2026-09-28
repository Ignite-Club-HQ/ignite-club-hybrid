import { describe, it, expect, beforeEach, vi } from "vitest";

const removeChannelMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { removeChannel: (...args: unknown[]) => removeChannelMock(...args) },
}));

import {
  registerChannel,
  revokeScope,
  revokeAllForUser,
  bindRealtimeRegistryQueryClient,
  _debugListChannels,
  _resetRealtimeRegistry,
} from "./realtimeChannelRegistry";
import type { RealtimeChannel } from "@supabase/supabase-js";

const makeChannel = () => ({} as unknown as RealtimeChannel);

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("realtimeChannelRegistry", () => {
  beforeEach(() => {
    _resetRealtimeRegistry();
    removeChannelMock.mockClear();
  });

  it("registers and unregisters a channel, tearing it down once", async () => {
    const ch = makeChannel();
    const off = registerChannel({
      key: "k1",
      channel: ch,
      userId: "u1",
      scope: { kind: "team", id: "t1" },
    });
    expect(_debugListChannels()).toHaveLength(1);
    off();
    await flush();
    expect(_debugListChannels()).toHaveLength(0);
    expect(removeChannelMock).toHaveBeenCalledWith(ch);
    // idempotent
    off();
    await flush();
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it("replaces an existing entry with the same key and tears down the old channel", async () => {
    const a = makeChannel();
    const b = makeChannel();
    registerChannel({ key: "k1", channel: a, userId: "u1", scope: { kind: "team", id: "t1" } });
    registerChannel({ key: "k1", channel: b, userId: "u1", scope: { kind: "team", id: "t1" } });
    await flush();
    expect(removeChannelMock).toHaveBeenCalledWith(a);
    expect(_debugListChannels()).toHaveLength(1);
  });

  it("revokeScope tears down only matching entries", async () => {
    const a = makeChannel();
    const b = makeChannel();
    const c = makeChannel();
    registerChannel({ key: "a", channel: a, userId: "u1", scope: { kind: "team", id: "t1" } });
    registerChannel({ key: "b", channel: b, userId: "u1", scope: { kind: "team", id: "t2" } });
    registerChannel({ key: "c", channel: c, userId: "u2", scope: { kind: "team", id: "t1" } });

    revokeScope("u1", { kind: "team", id: "t1" });
    await flush();

    const keys = _debugListChannels().map((e) => e.key).sort();
    expect(keys).toEqual(["b", "c"]);
    expect(removeChannelMock).toHaveBeenCalledWith(a);
  });

  it("revokeScope with empty id tears down all of that kind for the user", async () => {
    registerChannel({ key: "a", channel: makeChannel(), userId: "u1", scope: { kind: "team", id: "t1" } });
    registerChannel({ key: "b", channel: makeChannel(), userId: "u1", scope: { kind: "team", id: "t2" } });
    registerChannel({ key: "c", channel: makeChannel(), userId: "u1", scope: { kind: "club", id: "c1" } });

    revokeScope("u1", { kind: "team", id: "" });
    await flush();

    expect(_debugListChannels().map((e) => e.key)).toEqual(["c"]);
  });

  it("revokeAllForUser removes every entry for that user", async () => {
    registerChannel({ key: "a", channel: makeChannel(), userId: "u1", scope: { kind: "team", id: "t1" } });
    registerChannel({ key: "b", channel: makeChannel(), userId: "u1", scope: { kind: "dm", id: "d1" } });
    registerChannel({ key: "c", channel: makeChannel(), userId: "u2", scope: { kind: "team", id: "t1" } });

    revokeAllForUser("u1");
    await flush();

    expect(_debugListChannels().map((e) => e.key)).toEqual(["c"]);
  });

  it("evicts bound query cache keys on teardown", async () => {
    const removeQueries = vi.fn();
    bindRealtimeRegistryQueryClient({ removeQueries } as unknown as Parameters<typeof bindRealtimeRegistryQueryClient>[0]);

    const off = registerChannel({
      key: "k",
      channel: makeChannel(),
      userId: "u1",
      scope: { kind: "team", id: "t1" },
      cacheKeys: [["messages", "t1"], ["unread", "t1"]],
    });
    off();
    await flush();

    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ["messages", "t1"] });
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ["unread", "t1"] });
  });

  it("swallows Supabase removeChannel errors", async () => {
    removeChannelMock.mockRejectedValueOnce(new Error("closed"));
    const off = registerChannel({
      key: "k",
      channel: makeChannel(),
      userId: "u1",
      scope: { kind: "team", id: "t1" },
    });
    expect(() => off()).not.toThrow();
    await flush();
    expect(_debugListChannels()).toHaveLength(0);
  });
});
