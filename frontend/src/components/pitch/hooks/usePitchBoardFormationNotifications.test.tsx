import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFormationNotificationMessage,
  usePitchBoardFormationNotifications,
} from "./usePitchBoardFormationNotifications";
import type { Player } from "../types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  recipients: vi.fn(), fan: vi.fn(), matchNotify: vi.fn(),
}));
const icpMode = process.env.IGNITE_TEST_BACKEND_MODE === "icp";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => icpMode ? "icp" : "supabase" }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: async (_: string, providers: { icp: (ctx: unknown) => unknown }) => providers.icp({}) }));
vi.mock("./livePitchNotifications", () => ({ livePitchRecipients: mocks.recipients }));
vi.mock("@/live/features/notifications", () => ({ fanOutLiveNotifications: mocks.fan }));
vi.mock('@/live/features/events', () => ({ notifyLiveGroupPitch: mocks.matchNotify }));

function queryReturning(data: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.not = vi.fn(async () => ({ data }));
  return query;
}

function userRolesQuery(data: unknown[]) {
  const query = queryReturning(data);
  query.in = vi.fn(async () => ({ data }));
  return query;
}

const player = (id: string, name: string): Player => ({
  id,
  name,
  position: null,
});

describe("buildFormationNotificationMessage", () => {
  it("preserves the concise formation and team-size summaries", () => {
    expect(buildFormationNotificationMessage("formation", "2-3-1"))
      .toBe("Formation changed to 2-3-1");
    expect(buildFormationNotificationMessage("team_size", "7"))
      .toBe("Team size changed to 7 players");
  });

  it("describes players leaving, entering and moving in the established order", () => {
    expect(buildFormationNotificationMessage("formation", "3-2-1", {
      benchMoves: [
        { player: player("1", "Alex"), direction: "to-bench" },
        { player: player("2", "Blake"), direction: "to-pitch", position: "FWD" },
      ],
      positionSwaps: [{
        player: player("3", "Casey"),
        fromPosition: "DEF",
        toPosition: "MID",
      }],
    })).toBe(
      "Formation changed to 3-2-1 — 📤 Off: Alex • 📥 On: Blake (FWD) • 🔄 Moved: Casey DEF→MID",
    );
  });
});

describe("usePitchBoardFormationNotifications", () => {
  it.runIf(icpMode)('mini-league alerts use authoritative duty selection, including an unlinked board', async () => {
    const hook = renderHook(() => usePitchBoardFormationNotifications({ userId: 'u', teamId: 'event-group-g', readOnly: false, linkedEventId: null, isGameFinished: () => false }));
    await act(async () => hook.result.current('formation', '2-3-1'));
    expect(mocks.matchNotify).toHaveBeenCalledWith({}, 'g', 'formation', '2-3-1', expect.any(String));
    expect(mocks.recipients).not.toHaveBeenCalled();
    expect(mocks.fan).not.toHaveBeenCalled();
    hook.unmount();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.recipients.mockResolvedValue({ userIds: ["current-user", "coach", "admin", "subs"], clubId: "club-1" });
  });

  it.each([
    { userId: undefined, readOnly: false, finished: false },
    { userId: "current-user", readOnly: true, finished: false },
    { userId: "current-user", readOnly: false, finished: true },
  ])("does no database work when notification delivery is gated: %o", async ({
    userId,
    readOnly,
    finished,
  }) => {
    const { result } = renderHook(() => usePitchBoardFormationNotifications({
      userId,
      teamId: "team-1",
      readOnly,
      linkedEventId: "event-1",
      isGameFinished: () => finished,
    }));

    await act(async () => result.current("formation", "2-3-1"));

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.fan).not.toHaveBeenCalled();
  });

  it.runIf(!icpMode)("notifies current user, team staff and event Subs Managers exactly once", async () => {
    const staff = userRolesQuery([
      { user_id: "coach-1" },
      { user_id: "current-user" },
      { user_id: "duplicate" },
    ]);
    const duties = queryReturning([
      { assigned_to: "subs-manager" },
      { assigned_to: "duplicate" },
      { assigned_to: null },
    ]);
    mocks.from.mockImplementation((table: string) => {
      if (table === "user_roles") return staff;
      if (table === "duties") return duties;
      throw new Error(`Unexpected table: ${table}`);
    });

    const { result } = renderHook(() => usePitchBoardFormationNotifications({
      userId: "current-user",
      teamId: "team-1",
      readOnly: false,
      linkedEventId: "event-1",
      isGameFinished: () => false,
    }));
    await act(async () => result.current("team_size", "9"));

    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["user_roles", "duties"]);
    expect(staff.eq).toHaveBeenCalledWith("team_id", "team-1");
    expect(staff.in).toHaveBeenCalledWith("role", ["coach", "team_admin"]);
    expect(duties.eq).toHaveBeenNthCalledWith(1, "event_id", "event-1");
    expect(duties.eq).toHaveBeenNthCalledWith(2, "name", "Subs Manager");
    expect(mocks.rpc).toHaveBeenCalledWith("notify_formation_change", {
      _recipient_ids: ["current-user", "coach-1", "duplicate", "subs-manager"],
      _message: "Team size changed to 9 players",
      _related_id: "team-1",
    });
  });

  it.runIf(!icpMode)("uses only match duties for a mini-league event group", async () => {
    const duties = queryReturning([
      { assigned_to: "referee" },
      { assigned_to: "subs-manager" },
      { assigned_to: "current-user" },
    ]);
    mocks.from.mockImplementation((table: string) => {
      if (table === "event_group_duties") return duties;
      throw new Error(`Unexpected table: ${table}`);
    });

    const { result } = renderHook(() => usePitchBoardFormationNotifications({
      userId: "current-user",
      teamId: "event-group-group-42",
      readOnly: false,
      linkedEventId: "event-1",
      isGameFinished: () => false,
    }));
    await act(async () => result.current("formation", "4-3-3"));

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith("event_group_duties");
    expect(duties.eq).toHaveBeenCalledWith("group_id", "group-42");
    expect(duties.in).toHaveBeenCalledWith("name", ["Referee", "Subs Manager"]);
    expect(mocks.rpc).toHaveBeenCalledWith("notify_formation_change", {
      _recipient_ids: ["current-user", "referee", "subs-manager"],
      _message: "Formation changed to 4-3-3",
      _related_id: "event-group-group-42",
    });
  });

  it.runIf(!icpMode)("contains RPC failures instead of breaking the formation workflow", async () => {
    const error = { message: "function unavailable" };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.from.mockReturnValue(userRolesQuery([]));
    mocks.rpc.mockResolvedValue({ error });
    const { result } = renderHook(() => usePitchBoardFormationNotifications({
      userId: "current-user",
      teamId: "team-1",
      readOnly: false,
      isGameFinished: () => false,
    }));

    await expect(act(async () => result.current("formation", "2-3-1")))
      .resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "Formation notification RPC error:",
      JSON.stringify(error),
    );
    consoleError.mockRestore();
  });

  it.runIf(icpMode)("sends ICP formation alerts to the resolved club without putting child names in notifications", async () => {
    const { result } = renderHook(() => usePitchBoardFormationNotifications({
      userId: "current-user",
      teamId: "team-1",
      readOnly: false,
      linkedEventId: "event-1",
      isGameFinished: () => false,
    }));
    await act(async () => result.current("formation", "2-3-1", { benchMoves: [{ player: player("child", "Private Child"), direction: "to-bench" }], positionSwaps: [] }));
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.recipients).toHaveBeenCalledWith({}, "team-1", "event-1", "current-user", true, false);
    expect(mocks.fan).toHaveBeenCalledWith({}, expect.objectContaining({ clubId: "club-1", kind: "pitch_board", relatedId: "team-1", body: "Formation changed to 2-3-1" }));
  });
});
