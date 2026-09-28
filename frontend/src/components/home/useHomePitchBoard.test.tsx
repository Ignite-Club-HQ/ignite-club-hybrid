import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHomePitchBoard } from "./useHomePitchBoard";

function setup(overrides: Partial<Parameters<typeof useHomePitchBoard>[0]> = {}) {
  const args: Parameters<typeof useHomePitchBoard>[0] = {
    isAppAdmin: false,
    notifyProRequired: vi.fn(),
    hasProFootballAccess: vi.fn().mockResolvedValue(true),
    loadRoster: vi.fn().mockResolvedValue({
      members: [
        {
          id: "staff-role",
          user_id: "staff",
          role: "coach",
          profiles: { display_name: "Coach", avatar_url: null },
        },
        {
          id: "player-role",
          user_id: "adult-player",
          role: "player",
          profiles: { display_name: "Adult", avatar_url: null },
        },
      ],
      children: [
        { child_id: "child-going", child_name: "Going Child" },
        { child_id: "child-away", child_name: "Away Child" },
      ],
    }),
    findNearbyEvent: vi.fn().mockResolvedValue("event-1"),
    loadGoingRsvps: vi.fn().mockResolvedValue([
      { user_id: "adult-player", child_id: null },
      { user_id: null, child_id: "child-going" },
    ]),
    ...overrides,
  };
  return { args, ...renderHook(() => useHomePitchBoard(args)) };
}

describe("useHomePitchBoard", () => {
  afterEach(() => localStorage.clear());

  it("blocks non-admin users without Pro Football access", async () => {
    const notifyProRequired = vi.fn();
    const loadRoster = vi.fn();
    const { result } = setup({
      hasProFootballAccess: vi.fn().mockResolvedValue(false),
      notifyProRequired,
      loadRoster,
    });

    await act(() => result.current.openPitchBoard("team-1", "Ignite"));
    expect(notifyProRequired).toHaveBeenCalledOnce();
    expect(loadRoster).not.toHaveBeenCalled();
    expect(result.current.pitchBoardTeam).toBeNull();
    expect(result.current.pitchBoardLoading).toBe(false);
  });

  it("keeps staff and RSVP-going players while filtering the match roster", async () => {
    const { result } = setup();
    await act(() =>
      result.current.openPitchBoard("team-1", "Ignite", true),
    );

    expect(result.current.pitchBoardTeam).toMatchObject({
      id: "team-1",
      name: "Ignite",
      readOnly: true,
      linkedEventId: "event-1",
    });
    expect(
      result.current.pitchBoardTeam?.members.map((member) => member.user_id),
    ).toEqual(["staff", "adult-player", "child-going"]);
  });

  it("opens from the persisted timer event", async () => {
    localStorage.setItem(
      "pitch-board-timer-state",
      JSON.stringify({ teamId: "team-2", teamName: "Timer Team" }),
    );
    const findNearbyEvent = vi.fn().mockResolvedValue(null);
    const { result } = setup({ findNearbyEvent });

    act(() => window.dispatchEvent(new Event("open-pitch-board")));
    await waitFor(() =>
      expect(result.current.pitchBoardTeam?.id).toBe("team-2"),
    );
    expect(result.current.pitchBoardTeam?.name).toBe("Timer Team");
  });

  it("restores only Home-owned persisted pitch boards", async () => {
    localStorage.setItem("ignite-pitch-board-open", "true");
    localStorage.setItem("ignite-pitch-board-open-path", "/home?resume=1");
    localStorage.setItem(
      "ignite-pitch-board-last-context",
      JSON.stringify({
        teamId: "team-3",
        teamName: "Restored Team",
        readOnly: true,
      }),
    );
    const { result } = setup({ findNearbyEvent: vi.fn().mockResolvedValue(null) });
    await waitFor(() =>
      expect(result.current.pitchBoardTeam?.id).toBe("team-3"),
    );
    expect(result.current.pitchBoardTeam?.readOnly).toBe(true);
  });
});
