import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePitchBoardLifecycle } from "./usePitchBoardLifecycle";
import {
  PITCH_BOARD_LAST_CONTEXT_KEY,
  PITCH_BOARD_OPEN_KEY,
  PITCH_BOARD_OPEN_PATH_KEY,
} from "../types";

describe("usePitchBoardLifecycle route persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as any).__pitchBoardMounted;
    delete (window as any).__pitchBoardMountedThisSession;
    window.history.replaceState({}, "", "/events/event-1?tab=attendance");
  });

  it("atomically records that the board is open, its exact route and restore context", () => {
    renderHook(() => usePitchBoardLifecycle({
      teamId: "team-1",
      teamName: "U10 Blue",
      readOnly: false,
      subConfirmDialogOpen: false,
      toast: vi.fn(),
    }));

    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBe("true");
    expect(localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY)).toBe(
      "/events/event-1?tab=attendance",
    );
    expect(JSON.parse(localStorage.getItem(PITCH_BOARD_LAST_CONTEXT_KEY)!)).toEqual({
      teamId: "team-1",
      teamName: "U10 Blue",
      readOnly: false,
    });
    expect((window as any).__pitchBoardMounted).toBe(true);
    expect((window as any).__pitchBoardMountedThisSession).toBe(true);
  });

  it("keeps recovery state on transient unmount while marking the in-memory board absent", () => {
    const { unmount } = renderHook(() => usePitchBoardLifecycle({
      teamId: "team-1",
      teamName: "U10 Blue",
      readOnly: true,
      subConfirmDialogOpen: false,
      toast: vi.fn(),
    }));

    unmount();
    expect((window as any).__pitchBoardMounted).toBe(false);
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBe("true");
    expect(localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY)).toBe(
      "/events/event-1?tab=attendance",
    );
  });

  it("refreshes context and route when a board changes team or route", () => {
    const args = {
      teamId: "team-1",
      teamName: "U10 Blue",
      readOnly: false,
      subConfirmDialogOpen: false,
      toast: vi.fn(),
    };
    const { rerender } = renderHook(
      ({ value }) => usePitchBoardLifecycle(value),
      { initialProps: { value: args } },
    );

    window.history.replaceState({}, "", "/teams/team-2?openBoard=1");
    rerender({ value: { ...args, teamId: "team-2", teamName: "U12 Gold" } });

    expect(localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY)).toBe(
      "/teams/team-2?openBoard=1",
    );
    expect(JSON.parse(localStorage.getItem(PITCH_BOARD_LAST_CONTEXT_KEY)!)).toMatchObject({
      teamId: "team-2",
      teamName: "U12 Gold",
    });
  });
});
