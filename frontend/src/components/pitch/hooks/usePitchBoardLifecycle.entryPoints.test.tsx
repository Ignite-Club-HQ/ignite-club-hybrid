import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPitchBoardOpenFlag } from "../pitchBoardOpenFlag";
import {
  PITCH_BOARD_LAST_CONTEXT_KEY,
  PITCH_BOARD_OPEN_AT_KEY,
  PITCH_BOARD_OPEN_KEY,
  PITCH_BOARD_OPEN_PATH_KEY,
} from "../types";
import { usePitchBoardLifecycle } from "./usePitchBoardLifecycle";

type EntryCase = {
  label: string;
  path: string;
  teamId: string;
  teamName: string;
  readOnly: boolean;
};

const entries: EntryCase[] = [
  {
    label: "team-page Pitch Board tile",
    path: "/teams/team-1?from=game-day",
    teamId: "team-1",
    teamName: "U10 Blue",
    readOnly: false,
  },
  {
    label: "event-page Start Game / Open Match / Prepare Lineup",
    path: "/events/event-1?tab=attendance",
    teamId: "team-1",
    teamName: "U10 Blue",
    readOnly: false,
  },
  {
    label: "Home timer widget",
    path: "/",
    teamId: "team-1",
    teamName: "U10 Blue",
    readOnly: false,
  },
  {
    label: "Home notification resume",
    path: "/home?source=pending-sub",
    teamId: "team-1",
    teamName: "U10 Blue",
    readOnly: false,
  },
  {
    label: "Next Up event deep link",
    path: "/events/event-1?openPitchBoard=1",
    teamId: "team-1",
    teamName: "U10 Blue",
    readOnly: false,
  },
  {
    label: "chat-details pitch-board link",
    path: "/teams/team-1?openBoard=1",
    teamId: "team-1",
    teamName: "U10 Blue",
    readOnly: false,
  },
  {
    label: "direct mini-league match page",
    path: "/events/event-1/groups/group-1/pitch",
    teamId: "event-group-group-1",
    teamName: "Carnival - Pitch 1",
    readOnly: false,
  },
  {
    label: "mini-league live-match widget",
    path: "/",
    teamId: "event-group-group-2",
    teamName: "Carnival - Pitch 2",
    readOnly: false,
  },
  {
    label: "chat board viewer",
    path: "/messages/team-1",
    teamId: "team-1",
    teamName: "U10 Blue",
    readOnly: true,
  },
];

describe("pitch-board persistence from every production entry family", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    delete (window as any).__pitchBoardMounted;
    delete (window as any).__pitchBoardMountedThisSession;
  });

  it.each(entries)("$label persists exact route and context through a transient OS unmount", entry => {
    window.history.replaceState({}, "", entry.path);
    const toast = vi.fn();
    const { unmount } = renderHook(() => usePitchBoardLifecycle({
      teamId: entry.teamId,
      teamName: entry.teamName,
      readOnly: entry.readOnly,
      subConfirmDialogOpen: false,
      toast,
    }));

    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBe("true");
    expect(localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY)).toBe(entry.path);
    expect(Number(localStorage.getItem(PITCH_BOARD_OPEN_AT_KEY))).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem(PITCH_BOARD_LAST_CONTEXT_KEY)!)).toEqual({
      teamId: entry.teamId,
      teamName: entry.teamName,
      readOnly: entry.readOnly,
    });
    expect((window as any).__pitchBoardMounted).toBe(true);
    expect((window as any).__pitchBoardMountedThisSession).toBe(true);

    // React/WebView teardown during phone lock must not be treated as the user
    // explicitly closing the board.
    unmount();
    expect((window as any).__pitchBoardMounted).toBe(false);
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBe("true");
    expect(localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY)).toBe(entry.path);
  });

  it.each(entries)("$label explicit close clears every restore signal", entry => {
    window.history.replaceState({}, "", entry.path);
    const { unmount } = renderHook(() => usePitchBoardLifecycle({
      teamId: entry.teamId,
      teamName: entry.teamName,
      readOnly: entry.readOnly,
      subConfirmDialogOpen: false,
      toast: vi.fn(),
    }));

    clearPitchBoardOpenFlag();
    unmount();
    expect(localStorage.getItem(PITCH_BOARD_OPEN_KEY)).toBeNull();
    expect(localStorage.getItem(PITCH_BOARD_OPEN_PATH_KEY)).toBeNull();
    expect(localStorage.getItem(PITCH_BOARD_OPEN_AT_KEY)).toBeNull();
    expect(localStorage.getItem(PITCH_BOARD_LAST_CONTEXT_KEY)).toBeNull();
  });
});
