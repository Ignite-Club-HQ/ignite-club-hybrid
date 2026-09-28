import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, SubstitutionEvent } from "../types";
import { usePitchBoardUnlinkEvent } from "./usePitchBoardUnlinkEvent";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  savePitchState: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));
vi.mock("../pitchStateUtils", () => ({
  savePitchState: mocks.savePitchState,
}));

const player = (id: string, name: string, onPitch = false): Player => ({
  id,
  name,
  position: onPitch ? { x: 50, y: 50 } : null,
  minutesPlayed: 180,
});

function activeGamesUpdate(error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => (
    chain.eq.mock.calls.length === 3
      ? Promise.resolve({ error })
      : chain
  ));
  return chain;
}

function setup({
  teamId = "team-1",
  userId = "user-1",
  players = [player("player-1", "Alex", true), player("player-2", "Blake")],
}: {
  teamId?: string;
  userId?: string | null;
  players?: Player[];
} = {}) {
  const outgoing = players[0];
  const incoming = players[1] ?? player("player-2", "Blake");
  const autoSubPlan: SubstitutionEvent[] = [{
    time: 300,
    half: 1,
    playerOut: outgoing,
    playerIn: incoming,
    executed: false,
  }];
  const callbacks = {
    setLinkedEventId: vi.fn(),
    onUnlinkEvent: vi.fn(),
    invalidateTeamActiveGame: vi.fn(),
    notifyUnlinked: vi.fn(),
  };
  const args = {
    teamId,
    userId: userId ?? undefined,
    players,
    teamSize: "7" as const,
    selectedFormation: 2,
    ballPosition: { x: 41, y: 62 },
    autoSubPlan,
    autoSubActive: true,
    autoSubPaused: true,
    mockMode: false,
    goals: [{
      id: "goal-1",
      scorerId: outgoing.id,
      scorerName: outgoing.name,
      time: 120,
      half: 1 as const,
      isOpponentGoal: false,
    }],
    ...callbacks,
  };
  const hook = renderHook(
    ({ value }) => usePitchBoardUnlinkEvent(value),
    { initialProps: { value: args } },
  );
  return { ...hook, args, callbacks };
}

describe("usePitchBoardUnlinkEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists the complete unlinked snapshot and deactivates only this user's active game", async () => {
    const query = activeGamesUpdate();
    mocks.from.mockReturnValue(query);
    const { result, args, callbacks } = setup();

    await act(async () => result.current());

    expect(callbacks.setLinkedEventId).toHaveBeenCalledWith(null);
    expect(callbacks.onUnlinkEvent).toHaveBeenCalledOnce();
    expect(mocks.savePitchState).toHaveBeenCalledWith("team-1", {
      players: args.players,
      teamSize: "7",
      selectedFormation: 2,
      ballPosition: { x: 41, y: 62 },
      autoSubPlan: args.autoSubPlan,
      autoSubActive: true,
      autoSubPaused: true,
      mockMode: false,
      linkedEventId: null,
      goals: args.goals,
    });
    expect(mocks.from).toHaveBeenCalledWith("active_games");
    expect(query.update).toHaveBeenCalledWith({ is_active: false });
    expect(query.eq.mock.calls).toEqual([
      ["team_id", "team-1"],
      ["user_id", "user-1"],
      ["is_active", true],
    ]);
    expect(callbacks.invalidateTeamActiveGame).toHaveBeenCalledOnce();
    expect(callbacks.notifyUnlinked).toHaveBeenCalledOnce();
  });

  it("clears the UI link before persisting and confirming the unlink", async () => {
    mocks.from.mockReturnValue(activeGamesUpdate());
    const { result, callbacks } = setup();
    await act(async () => result.current());

    expect(callbacks.setLinkedEventId.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.savePitchState.mock.invocationCallOrder[0]);
    expect(mocks.savePitchState.mock.invocationCallOrder[0])
      .toBeLessThan(callbacks.invalidateTeamActiveGame.mock.invocationCallOrder[0]);
    expect(callbacks.invalidateTeamActiveGame.mock.invocationCallOrder[0])
      .toBeLessThan(callbacks.notifyUnlinked.mock.invocationCallOrder[0]);
  });

  it.each([
    { label: "mini-league event groups", teamId: "event-group-match-7", userId: "user-1" },
    { label: "signed-out boards", teamId: "team-1", userId: null },
  ])("does not mutate active_games for $label", async ({ teamId, userId }) => {
    const { result, callbacks } = setup({ teamId, userId });
    await act(async () => result.current());

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.savePitchState).toHaveBeenCalled();
    expect(callbacks.invalidateTeamActiveGame).toHaveBeenCalledOnce();
    expect(callbacks.notifyUnlinked).toHaveBeenCalledOnce();
  });

  it("retains the existing non-fatal resolved database-error behavior", async () => {
    mocks.from.mockReturnValue(activeGamesUpdate({ message: "update denied" }));
    const { result, callbacks } = setup();

    await expect(act(async () => result.current())).resolves.toBeUndefined();
    expect(callbacks.invalidateTeamActiveGame).toHaveBeenCalledOnce();
    expect(callbacks.notifyUnlinked).toHaveBeenCalledOnce();
  });

  it("uses the latest board snapshot after roster changes", async () => {
    mocks.from.mockReturnValue(activeGamesUpdate());
    const original = [player("player-1", "Alex", true), player("player-2", "Blake")];
    const latest = [...original, player("fill-in", "Casey")];
    const { result, rerender, args } = setup({ players: original });

    rerender({ value: { ...args, players: latest } });
    await act(async () => result.current());

    expect(mocks.savePitchState).toHaveBeenCalledWith(
      "team-1",
      expect.objectContaining({ players: latest }),
    );
  });
});
