import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isNative: true,
  appStateHandler: null as null | ((state: { isActive: boolean }) => void),
  remove: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.isNative },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_event: string, handler: (state: { isActive: boolean }) => void) => {
      native.appStateHandler = handler;
      return { remove: native.remove };
    }),
  },
}));

import PitchBoardResumeRedirect from "./PitchBoardResumeRedirect";
import {
  PITCH_BOARD_LAST_CONTEXT_KEY,
  PITCH_BOARD_OPEN_AT_KEY,
  PITCH_BOARD_OPEN_KEY,
  PITCH_BOARD_OPEN_PATH_KEY,
} from "./types";

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{location.pathname}{location.search}</output>
      <button onClick={() => navigate("/")}>home</button>
      <button onClick={() => navigate("/media")}>media</button>
    </>
  );
}

function mountAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PitchBoardResumeRedirect />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function persistOpenBoard(path: string) {
  localStorage.setItem(PITCH_BOARD_OPEN_KEY, "true");
  localStorage.setItem(PITCH_BOARD_OPEN_PATH_KEY, path);
  localStorage.setItem(PITCH_BOARD_OPEN_AT_KEY, String(Date.now()));
  localStorage.setItem(
    PITCH_BOARD_LAST_CONTEXT_KEY,
    JSON.stringify({ teamId: "team-1", teamName: "U10 Blue", readOnly: false }),
  );
}

async function signalNativeResume() {
  await waitFor(() => expect(native.appStateHandler).toBeTypeOf("function"));
  await act(async () => native.appStateHandler?.({ isActive: true }));
}

describe("PitchBoardResumeRedirect lock/unlock recovery", () => {
  beforeEach(() => {
    localStorage.clear();
    native.isNative = true;
    native.appStateHandler = null;
    native.remove.mockClear();
    delete (window as any).__pitchBoardMounted;
    delete (window as any).__pitchBoardMountedThisSession;
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("cold-starts from home back onto the exact event pitchboard route", async () => {
    persistOpenBoard("/events/event-1?tab=attendance");
    mountAt("/");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/events/event-1?tab=attendance&openPitchBoard=1",
      ),
    );
  });

  it("restores a team-scoped board and preserves its existing query", async () => {
    persistOpenBoard("/teams/team-1?from=game-day");
    mountAt("/");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/teams/team-1?from=game-day&openPitchBoard=1",
      ),
    );
  });

  it("cold restart restores the board even when the WebView revives a different cached route", async () => {
    persistOpenBoard("/teams/team-1?from=game-day&tab=lineup");

    // Android can recreate the WebView using a cached navigation entry rather
    // than the configured start URL. The recent open-board marker must win.
    mountAt("/messages");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/teams/team-1?from=game-day&tab=lineup&openPitchBoard=1",
      ),
    );
  });

  it("warm unlock repairs route drift that occurred while the app was hidden", async () => {
    // Control the component's scheduled restore retries so they cannot race
    // the transient "/media" drift assertion under load.
    vi.useFakeTimers();
    try {
      persistOpenBoard("/events/event-1?tab=lineup");
      (window as any).__pitchBoardMountedThisSession = true;
      (window as any).__pitchBoardMounted = false;
      mountAt("/events/event-1?tab=lineup");

      let visibility: DocumentVisibilityState = "hidden";
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      // Model the native WebView restoring an older history entry while the
      // phone is locked. This is not a user navigation and must not close the
      // persisted board.
      await act(async () => screen.getByRole("button", { name: "media" }).click());
      expect(screen.getByTestId("location")).toHaveTextContent("/media");

      // Date.now() is frozen under fake timers; advance past the component's
      // 250ms same-attempt debounce before firing the foreground restore.
      act(() => {
        vi.advanceTimersByTime(300);
      });

      visibility = "visible";
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));

      expect(screen.getByTestId("location")).toHaveTextContent(
        "/events/event-1?tab=lineup&openPitchBoard=1",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("converges on the exact board route under repeated unlock signals", async () => {
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    (window as any).__pitchBoardMounted = false;
    mountAt("/events/event-1");

    let visibility: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => screen.getByRole("button", { name: "media" }).click());
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/media"));

    await waitFor(() => expect(native.appStateHandler).toBeTypeOf("function"));
    visibility = "visible";
    await act(async () => {
      native.appStateHandler?.({ isActive: true });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("pageshow"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/events/event-1?openPitchBoard=1",
      ),
    );
  });

  it("warm unlock reopens a board whose React modal was lost on its existing route", async () => {
    vi.mocked(performance.now).mockReturnValue(30_000);
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    (window as any).__pitchBoardMounted = false;
    mountAt("/events/event-1");

    await signalNativeResume();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/events/event-1?openPitchBoard=1",
      ),
    );
  });

  it("does not navigate while the pitchboard remains mounted", async () => {
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    (window as any).__pitchBoardMounted = true;
    mountAt("/");

    await signalNativeResume();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("does not hijack an unrelated non-neutral page after unlock", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    (window as any).__pitchBoardMounted = true;
    mountAt("/events/event-1");

    // Model deliberate foreground navigation after bootstrap has settled,
    // rather than a cached route supplied during the restore lease.
    now.mockReturnValue(32_000);
    (window as any).__pitchBoardMounted = false;
    await act(async () => screen.getByRole("button", { name: "media" }).click());

    await signalNativeResume();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/media"));
  });

  it("does not restore a different route when the persisted board marker is stale", async () => {
    persistOpenBoard("/events/event-1");
    localStorage.setItem(
      PITCH_BOARD_OPEN_AT_KEY,
      String(Date.now() - (12 * 60 * 60 * 1000 + 1)),
    );
    mountAt("/messages");

    await signalNativeResume();
    expect(screen.getByTestId("location")).toHaveTextContent("/messages");
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBeNull();
  });

  it("clears a stale previous-session flag instead of reopening it on warm resume", async () => {
    vi.mocked(performance.now).mockReturnValue(30_000);
    persistOpenBoard("/events/event-1");
    localStorage.removeItem(PITCH_BOARD_OPEN_AT_KEY);
    mountAt("/");

    await signalNativeResume();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBeNull();
    expect(localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY)).toBeNull();
    expect(localStorage.getItem(PITCH_BOARD_LAST_CONTEXT_KEY)).toBeNull();
  });

  it("treats navigation from the board route to Home as an explicit close", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    mountAt("/events/event-1");

    // Once the cold-start lease has elapsed, leaving the board route is a
    // foreground user action and must clear the persisted open marker.
    now.mockReturnValue(32_000);
    await act(async () => screen.getByRole("button", { name: "home" }).click());
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBeNull();

    await signalNativeResume();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("leaves a home-overlay board for HomePage to restore", async () => {
    persistOpenBoard("/");
    mountAt("/");
    await signalNativeResume();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBe("true");
  });

  it("cancels delayed native-resume retries when the redirect unmounts", async () => {
    persistOpenBoard("/events/event-1");
    (window as any).__pitchBoardMountedThisSession = true;
    (window as any).__pitchBoardMounted = true;
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const view = mountAt("/media");

    await signalNativeResume();
    const resumeTimerIds = setTimeoutSpy.mock.calls.flatMap(([, delay], index) =>
      delay === 400 || delay === 1200
        ? [setTimeoutSpy.mock.results[index].value]
        : [],
    );
    expect(resumeTimerIds).toHaveLength(2);
    view.unmount();

    // These are the two timers that previously escaped teardown and fired
    // after jsdom had removed `window`.
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(resumeTimerIds.length);
    expect(
      resumeTimerIds.every((id) => {
        const timer = id as unknown as { _destroyed?: boolean; _idleTimeout?: number };
        return timer._destroyed === true || timer._idleTimeout === -1;
      }),
    ).toBe(true);
  });
});
