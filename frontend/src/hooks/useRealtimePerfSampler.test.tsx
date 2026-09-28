import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channels: [] as Array<{
    name: string;
    handlers: Array<{ type: string; config: Record<string, unknown>; callback: (payload: any) => void }>;
    subscribe: ReturnType<typeof vi.fn>;
  }>,
  insert: vi.fn().mockResolvedValue({ error: null }),
  removeChannel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn((name: string) => {
      const channel = {
        name,
        handlers: [] as Array<{
          type: string;
          config: Record<string, unknown>;
          callback: (payload: any) => void;
        }>,
        on(type: string, config: Record<string, unknown>, callback: (payload: any) => void) {
          this.handlers.push({ type, config, callback });
          return this;
        },
        subscribe: vi.fn().mockReturnThis(),
      };
      mocks.channels.push(channel);
      return channel;
    }),
    from: vi.fn(() => ({ insert: mocks.insert })),
    removeChannel: mocks.removeChannel,
  },
}));

vi.mock("@/lib/nativePush", () => ({
  getPlatform: () => "web",
}));

import { useRealtimePerfSampler } from "./useRealtimePerfSampler";

describe("useRealtimePerfSampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.channels.length = 0;
    mocks.insert.mockClear();
    mocks.removeChannel.mockClear();
  });

  it("scopes notification and read-receipt subscriptions to the current user", () => {
    renderHook(() => useRealtimePerfSampler("user-123"));

    expect(mocks.channels).toHaveLength(2);
    expect(mocks.channels[0].handlers[0].config).toMatchObject({
      table: "notifications",
      filter: "user_id=eq.user-123",
    });
    expect(mocks.channels[1].handlers[0].config).toMatchObject({
      table: "message_reads",
    });
    expect(mocks.channels[1].handlers[0].config).not.toHaveProperty("filter");
  });

  it("batches valid latency samples and flushes them without affecting the app", async () => {
    const now = Date.now();
    renderHook(() => useRealtimePerfSampler("user-123"));

    act(() => {
      mocks.channels[0].handlers[0].callback({
        new: { created_at: new Date(now - 250).toISOString() },
      });
      vi.advanceTimersByTime(30_000);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: "user-123",
        platform: "web",
        channel: "notifications",
        event: "INSERT",
      }),
    ]);
  });

  it("does not subscribe for signed-out users or unsampled sessions", () => {
    const first = renderHook(() => useRealtimePerfSampler(undefined));
    expect(mocks.channels).toHaveLength(0);
    first.unmount();

    vi.mocked(Math.random).mockReturnValue(0.99);
    renderHook(() => useRealtimePerfSampler("user-123"));
    expect(mocks.channels).toHaveLength(0);
  });

  it("removes both telemetry channels during cleanup", () => {
    const { unmount } = renderHook(() => useRealtimePerfSampler("user-123"));
    const created = [...mocks.channels];

    unmount();

    expect(mocks.removeChannel).toHaveBeenCalledTimes(2);
    expect(mocks.removeChannel).toHaveBeenCalledWith(created[0]);
    expect(mocks.removeChannel).toHaveBeenCalledWith(created[1]);
  });
});
