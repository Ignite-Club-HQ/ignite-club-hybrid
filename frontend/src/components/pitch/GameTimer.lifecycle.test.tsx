import { act, createRef } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GameTimer, { type GameTimerRef } from "./GameTimer";
import type { ServerTimer, TimerReadResponse } from "@/lib/serverTimer";

const server = vi.hoisted(() => ({
  read: vi.fn<() => Promise<TimerReadResponse>>(),
  send: vi.fn(),
}));

vi.mock("@/lib/serverTimer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/serverTimer")>();
  return {
    ...actual,
    readServerTimer: server.read,
    sendTimerEvent: server.send,
  };
});

vi.mock("@/hooks/useWakeLock", () => ({ useWakeLock: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  requestNotificationPermission: vi.fn().mockResolvedValue(undefined),
  showBrowserNotification: vi.fn(),
}));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}));

const NOW = Date.UTC(2026, 6, 25, 10, 0, 0);

const snapshot = (
  elapsedSeconds: number,
  overrides: Partial<ServerTimer> = {},
): ServerTimer => ({
  schema_version: 2,
  current_half: 1,
  minutes_per_half: 40,
  half_started_at: new Date(NOW - elapsedSeconds * 1000).toISOString(),
  half_paused_at: new Date(NOW).toISOString(),
  accumulated_pause_ms: 0,
  is_running: false,
  is_game_finished: false,
  half_ended_at: null,
  last_event_at: new Date(NOW).toISOString(),
  ...overrides,
});

const response = (timer: ServerTimer): TimerReadResponse => ({
  found: true,
  row_id: "local-row",
  team_id: "team-a",
  timer_state: timer,
  elapsed_seconds: 0,
  server_now: new Date(NOW).toISOString(),
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("GameTimer lock, background and hydration lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
    server.read.mockReset();
    server.send.mockReset();
    server.send.mockResolvedValue({
      ok: true,
      row_id: "local-row",
      timer_state: snapshot(0),
      elapsed_seconds: 0,
      server_now: new Date(NOW).toISOString(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hydrates a sixteen-minute server timer without briefly replacing it with zero", async () => {
    server.read.mockResolvedValue(response(snapshot(16 * 60)));
    const ref = createRef<GameTimerRef>();

    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    expect(ref.current?.getElapsedSeconds()).toBe(16 * 60);
    expect(ref.current?.getCurrentHalf()).toBe(1);
  });

  it("must never move a live timer backwards when a resume read returns a stale zero snapshot", async () => {
    server.read.mockResolvedValue(response(snapshot(16 * 60)));
    const ref = createRef<GameTimerRef>();
    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();
    expect(ref.current?.getElapsedSeconds()).toBe(16 * 60);

    server.read.mockResolvedValue(response(snapshot(0)));
    window.dispatchEvent(new Event("focus"));
    await settle();

    expect(ref.current?.getElapsedSeconds()).toBeGreaterThanOrEqual(16 * 60);
  });

  it("accepts a newer authoritative snapshot after the phone resumes", async () => {
    server.read.mockResolvedValue(response(snapshot(16 * 60)));
    const ref = createRef<GameTimerRef>();
    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    server.read.mockResolvedValue(response(snapshot(21 * 60, {
      last_event_at: new Date(NOW + 60_000).toISOString(),
    })));
    window.dispatchEvent(new Event("pageshow"));
    await settle();

    expect(ref.current?.getElapsedSeconds()).toBe(21 * 60);
  });

  it("recovers the full uncapped lock duration from local storage when the server is unavailable", async () => {
    server.read.mockResolvedValue({ found: false, server_now: new Date(NOW).toISOString() });
    localStorage.setItem("pitch-board-timer-state-team-team-a", JSON.stringify({
      schema_version: 2,
      minutesPerHalf: 40,
      currentHalf: 1,
      elapsedSeconds: 16 * 60,
      isRunning: true,
      lastUpdateTime: NOW - 5 * 60 * 1000,
      teamId: "team-a",
      teamName: "Synthetic",
    }));
    const ref = createRef<GameTimerRef>();

    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    expect(ref.current?.getElapsedSeconds()).toBe(21 * 60);
    expect(ref.current?.isRunning()).toBe(true);
  });

  it("never hydrates another team's active timer into the current pitch board", async () => {
    server.read.mockResolvedValue({ found: false, server_now: new Date(NOW).toISOString() });
    localStorage.setItem("pitch-board-timer-state", JSON.stringify({
      minutesPerHalf: 40,
      currentHalf: 1,
      elapsedSeconds: 16 * 60,
      isRunning: true,
      lastUpdateTime: NOW,
      teamId: "team-b",
    }));
    const ref = createRef<GameTimerRef>();

    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    expect(ref.current?.getElapsedSeconds()).toBe(0);
    expect(ref.current?.isRunning()).toBe(false);
  });

  it("does not resurrect a manually reset timer from elapsed wall time", async () => {
    server.read.mockResolvedValue({ found: false, server_now: new Date(NOW).toISOString() });
    localStorage.setItem("pitch-board-timer-state-team-team-a", JSON.stringify({
      schema_version: 2,
      minutesPerHalf: 40,
      currentHalf: 1,
      elapsedSeconds: 0,
      isRunning: false,
      lastUpdateTime: NOW - 30 * 60 * 1000,
      teamId: "team-a",
      manualReset: true,
    }));
    const ref = createRef<GameTimerRef>();

    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    expect(ref.current?.getElapsedSeconds()).toBe(0);
    expect(ref.current?.isRunning()).toBe(false);
  });

  it("credits real wall-clock time when interval callbacks are throttled", async () => {
    server.read.mockResolvedValue(response(snapshot(16 * 60, {
      is_running: true,
      half_paused_at: null,
    })));
    const ref = createRef<GameTimerRef>();
    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    expect(ref.current?.getElapsedSeconds()).toBe(16 * 60);
    await act(async () => {
      // Model a WebView that delivers one late callback rather than five
      // reliable one-second callbacks.
      vi.advanceTimersByTime(5_000);
    });
    expect(ref.current?.getElapsedSeconds()).toBe(16 * 60 + 5);
  });

  it("uses server time rather than a device clock that is two minutes slow", async () => {
    const serverNow = NOW + 2 * 60 * 1000;
    const value = snapshot(0, {
      is_running: true,
      half_paused_at: null,
      half_started_at: new Date(serverNow - 16 * 60 * 1000).toISOString(),
      last_event_at: new Date(serverNow - 16 * 60 * 1000).toISOString(),
    });
    server.read.mockResolvedValue({ ...response(value), server_now: new Date(serverNow).toISOString() });
    const ref = createRef<GameTimerRef>();
    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    expect(ref.current?.getElapsedSeconds()).toBe(16 * 60);
  });

  it("does not advance a paused timer while the phone is locked", async () => {
    const paused = snapshot(16 * 60);
    server.read.mockResolvedValue(response(paused));
    const ref = createRef<GameTimerRef>();
    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(ref.current?.getElapsedSeconds()).toBe(16 * 60);
    expect(ref.current?.isRunning()).toBe(false);
  });

  it("maps an authoritative end-of-first-half snapshot to the halftime UI", async () => {
    server.read.mockResolvedValue(response(snapshot(40 * 60, {
      current_half: 1,
      is_running: false,
      half_paused_at: null,
      half_ended_at: new Date(NOW).toISOString(),
    })));
    const ref = createRef<GameTimerRef>();
    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    expect(ref.current?.getCurrentHalf()).toBe(2);
    expect(ref.current?.getElapsedSeconds()).toBe(0);
    expect(ref.current?.isRunning()).toBe(false);
  });

  it("hydrates full time without restarting or wrapping the second half", async () => {
    server.read.mockResolvedValue(response(snapshot(40 * 60, {
      current_half: 2,
      is_running: false,
      is_game_finished: true,
      half_paused_at: null,
      half_ended_at: new Date(NOW).toISOString(),
    })));
    const ref = createRef<GameTimerRef>();
    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    expect(ref.current?.getCurrentHalf()).toBe(2);
    expect(ref.current?.getElapsedSeconds()).toBe(40 * 60);
    expect(ref.current?.isGameFinished()).toBe(true);
    expect(ref.current?.isRunning()).toBe(false);
  });

  it("accepts a newer explicit reset but rejects an old zero row", async () => {
    const live = snapshot(16 * 60, { last_event_at: new Date(NOW).toISOString() });
    server.read.mockResolvedValue(response(live));
    const ref = createRef<GameTimerRef>();
    render(<GameTimer ref={ref} teamId="team-a" compact />);
    await settle();

    server.read.mockResolvedValue(response(snapshot(0, {
      half_started_at: null,
      half_paused_at: null,
      last_event_at: new Date(NOW - 60_000).toISOString(),
    })));
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(ref.current?.getElapsedSeconds()).toBe(16 * 60);

    server.read.mockResolvedValue(response(snapshot(0, {
      half_started_at: null,
      half_paused_at: null,
      last_event_at: new Date(NOW + 60_000).toISOString(),
    })));
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(ref.current?.getElapsedSeconds()).toBe(0);
    expect(ref.current?.isRunning()).toBe(false);
  });
});
