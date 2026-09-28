import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { channel, removeChannel, from, channels, databaseState, syncControl, updateAttempts } = vi.hoisted(() => ({
  channel: vi.fn(),
  removeChannel: vi.fn(),
  from: vi.fn(),
  channels: new Map<string, any>(),
  databaseState: {
    pitch_state: { players: [{ id: "remote-player" }] },
    timer_state: { elapsedSeconds: 300, currentHalf: 1 },
  } as any,
  syncControl: { updateError: null as any },
  updateAttempts: [] as any[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel, removeChannel, from },
}));

import { useEventGroupSync } from "./useEventGroupSync";

function makeChannel(name: string, options: unknown) {
  const record: any = { name, options };
  record.on = vi.fn((_type: string, config: any, handler: (payload: any) => void) => {
    record.config = config;
    record.handler = handler;
    return record;
  });
  record.subscribe = vi.fn(() => record);
  record.send = vi.fn().mockResolvedValue("ok");
  channels.set(name, record);
  return record;
}

function eventGroupQuery() {
  let mode: "read" | "update" = "read";
  const query: any = {};
  query.select = vi.fn(() => query);
  query.update = vi.fn((payload: any) => {
    mode = "update";
    updateAttempts.push(payload);
    return query;
  });
  query.eq = vi.fn(() => query);
  query.is = vi.fn(() => query);
  query.single = vi.fn(async () => ({ data: databaseState, error: null }));
  query.maybeSingle = vi.fn(async () => ({ data: databaseState, error: null }));
  Object.defineProperty(query, "then", {
    value: (resolve: any) =>
      Promise.resolve(
        mode === "update"
          ? {
              data: syncControl.updateError ? null : [{ id: "group-1" }],
              error: syncControl.updateError,
            }
          : { data: databaseState, error: null },
      ).then(resolve),
  });
  return query;
}

const teamId = "event-group-group-1";
const pitchKey = `ignite-pitch-board-state-team-${teamId}`;
const timerKey = `pitch-board-timer-state-team-${teamId}`;

describe("useEventGroupSync realtime lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    channels.clear();
    vi.clearAllMocks();
    databaseState.pitch_state = { players: [{ id: "remote-player" }] };
    databaseState.timer_state = { elapsedSeconds: 300, currentHalf: 1 };
    syncControl.updateError = null;
    updateAttempts.length = 0;
    channel.mockImplementation(makeChannel);
    from.mockImplementation(() => eventGroupQuery());
  });

  it("does not subscribe or query when no event-group identity exists", () => {
    const { result } = renderHook(() => useEventGroupSync("ordinary-team", null));

    expect(result.current.isEventGroup).toBe(false);
    expect(channel).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("subscribes to the exact group with self-broadcast disabled", async () => {
    renderHook(() => useEventGroupSync(teamId, null));
    const record = channels.get("event-group:group-1");

    expect(channel).toHaveBeenCalledWith("event-group:group-1", {
      config: { broadcast: { self: false } },
    });
    expect(record.config).toEqual({ event: "state-changed" });
    await waitFor(() => expect(from).toHaveBeenCalledWith("event_groups"));
  });

  it("applies a newer realtime state and emits one same-tab change event", async () => {
    const changed = vi.fn();
    window.addEventListener("game-state-changed", changed);
    renderHook(() => useEventGroupSync(teamId, null));
    const record = channels.get("event-group:group-1");
    await waitFor(() => expect(localStorage.getItem(pitchKey)).not.toBeNull());

    databaseState.pitch_state = { players: [{ id: "newer-player" }] };
    databaseState.timer_state = { elapsedSeconds: 420, currentHalf: 1 };
    await act(async () => {
      record.handler({ payload: { version: 200 } });
    });

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(pitchKey)!)).toMatchObject({
        teamId,
        players: [{ id: "newer-player" }],
      }),
    );
    expect(JSON.parse(localStorage.getItem(timerKey)!)).toMatchObject({
      teamId,
      elapsedSeconds: 420,
    });
    expect(changed).toHaveBeenCalledOnce();
    window.removeEventListener("game-state-changed", changed);
  });

  it("ignores duplicate and older realtime versions", async () => {
    const changed = vi.fn();
    window.addEventListener("game-state-changed", changed);
    renderHook(() => useEventGroupSync(teamId, null));
    const record = channels.get("event-group:group-1");
    await waitFor(() => expect(localStorage.getItem(pitchKey)).not.toBeNull());

    await act(async () => record.handler({ payload: { version: 200 } }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    const readsAfterNewVersion = from.mock.calls.length;

    await act(async () => record.handler({ payload: { version: 200 } }));
    await act(async () => record.handler({ payload: { version: 199 } }));

    expect(from).toHaveBeenCalledTimes(readsAfterNewVersion);
    expect(changed).toHaveBeenCalledOnce();
    window.removeEventListener("game-state-changed", changed);
  });

  it("preserves populated local state during initial load but replaces it after a realtime signal", async () => {
    const localPitch = { players: [{ id: "local-player" }], teamId };
    const localTimer = { elapsedSeconds: 120, teamId };
    localStorage.setItem(pitchKey, JSON.stringify(localPitch));
    localStorage.setItem(timerKey, JSON.stringify(localTimer));
    renderHook(() => useEventGroupSync(teamId, null));
    const record = channels.get("event-group:group-1");

    await waitFor(() => expect(from).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem(pitchKey)!)).toEqual(localPitch);
    expect(JSON.parse(localStorage.getItem(timerKey)!)).toEqual(localTimer);

    await act(async () => record.handler({ payload: { version: 300 } }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(pitchKey)!).players[0].id).toBe(
        "remote-player",
      ),
    );
  });

  it("removes the old channel when the group changes and the active channel on unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ id }) => useEventGroupSync(id, null),
      { initialProps: { id: "event-group-one" } },
    );
    const first = channels.get("event-group:one");

    rerender({ id: "event-group-two" });
    const second = channels.get("event-group:two");
    expect(removeChannel).toHaveBeenCalledWith(first);

    unmount();
    expect(removeChannel).toHaveBeenCalledWith(second);
  });

  it("writes and broadcasts a local state only once while it remains unchanged", async () => {
    localStorage.setItem(pitchKey, JSON.stringify({ players: [{ id: "local" }], teamId }));
    localStorage.setItem(timerKey, JSON.stringify({ elapsedSeconds: 120, teamId }));
    const { result } = renderHook(() => useEventGroupSync(teamId, null));
    const record = channels.get("event-group:group-1");
    await waitFor(() => expect(from).toHaveBeenCalled());

    act(() => result.current.forceSync());
    await waitFor(() => expect(updateAttempts).toHaveLength(1));
    await waitFor(() => expect(record.send).toHaveBeenCalledOnce());
    act(() => result.current.forceSync());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateAttempts).toHaveLength(1);
    expect(record.send).toHaveBeenCalledOnce();
  });

  it("retries the same local state after a database update failure", async () => {
    localStorage.setItem(pitchKey, JSON.stringify({ players: [{ id: "local" }], teamId }));
    syncControl.updateError = { message: "temporary write failure" };
    const { result } = renderHook(() => useEventGroupSync(teamId, null));
    const record = channels.get("event-group:group-1");

    act(() => result.current.forceSync());
    await waitFor(() => expect(updateAttempts).toHaveLength(1));
    expect(record.send).not.toHaveBeenCalled();

    syncControl.updateError = null;
    act(() => result.current.forceSync());
    await waitFor(() => expect(updateAttempts).toHaveLength(2));
    await waitFor(() => expect(record.send).toHaveBeenCalledOnce());
  });

  it("ignores an echoed signal at the version just broadcast by this client", async () => {
    vi.spyOn(Date, "now").mockReturnValue(500);
    localStorage.setItem(pitchKey, JSON.stringify({ players: [{ id: "local" }], teamId }));
    const { result } = renderHook(() => useEventGroupSync(teamId, null));
    const record = channels.get("event-group:group-1");

    act(() => result.current.forceSync());
    await waitFor(() => expect(record.send).toHaveBeenCalledOnce());
    const callsBeforeEcho = from.mock.calls.length;
    await act(async () => record.handler({ payload: { version: 500 } }));

    expect(from).toHaveBeenCalledTimes(callsBeforeEcho);
  });

  it("does not repeat a successful database write merely because broadcast delivery fails", async () => {
    localStorage.setItem(pitchKey, JSON.stringify({ players: [{ id: "local" }], teamId }));
    localStorage.setItem(timerKey, JSON.stringify({ elapsedSeconds: 120, teamId }));
    const { result } = renderHook(() => useEventGroupSync(teamId, null));
    const record = channels.get("event-group:group-1");
    record.send.mockRejectedValue(new Error("realtime unavailable"));

    act(() => result.current.forceSync());
    await waitFor(() => expect(updateAttempts).toHaveLength(1));
    await waitFor(() => expect(record.send).toHaveBeenCalledOnce());
    act(() => result.current.forceSync());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateAttempts).toHaveLength(1);
  });
});
