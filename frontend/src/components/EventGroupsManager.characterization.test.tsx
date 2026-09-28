import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Operation = {
  table: string;
  kind: "insert" | "update" | "delete";
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

const mocks = vi.hoisted(() => ({
  mutations: [] as any[],
  operations: [] as Operation[],
  results: {} as Record<string, Array<{ data: any; error: any }>>,
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  rpc: vi.fn(),
  groups: [] as any[],
  allPlayers: [] as any[],
  eventRsvps: [] as any[],
  previousEvents: [] as any[],
}));

const mutationNames = [
  "createGroup",
  "autoGenerate",
  "quickSetup",
  "copyPrevious",
  "deleteGroup",
  "deleteAllGroups",
  "movePlayer",
  "swapPlayers",
];

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: (options: any) => {
    const values: Record<string, any> = {
      "event-groups": mocks.groups,
      "mini-league-settings": {
        id: "league-1",
        name: "Synthetic League",
        team_size: 4,
        min_players_per_side: 2,
        minutes_per_half: 15,
        bib_colors: ["#111111", "#eeeeee"],
        show_matches_to_members: true,
      },
      "mini-league-players": mocks.allPlayers,
      "event-rsvps-going": mocks.eventRsvps,
      "event-all-group-duties": {},
      "parent-profiles-for-duties": [],
      "previous-mini-league-events": mocks.previousEvents,
    };
    return { data: values[options.queryKey?.[0]], isLoading: false, refetch: vi.fn() };
  },
  useMutation: (options: any) => {
    mocks.mutations.push(options);
    return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  },
}));

function takeResult(table: string, kind: string) {
  return mocks.results[`${table}:${kind}`]?.shift() ?? { data: null, error: null };
}

function queryFor(table: string) {
  let operation: Operation | null = null;
  let selectedAfterWrite = false;
  const query: any = {};
  query.select = vi.fn(() => {
    selectedAfterWrite = operation !== null;
    return query;
  });
  query.insert = vi.fn((payload: unknown) => {
    operation = { table, kind: "insert", payload, filters: [] };
    mocks.operations.push(operation);
    return query;
  });
  query.update = vi.fn((payload: unknown) => {
    operation = { table, kind: "update", payload, filters: [] };
    mocks.operations.push(operation);
    return query;
  });
  query.delete = vi.fn(() => {
    operation = { table, kind: "delete", filters: [] };
    mocks.operations.push(operation);
    return query;
  });
  query.eq = vi.fn((column: string, value: unknown) => {
    operation?.filters.push([column, value]);
    return query;
  });
  for (const method of ["in", "neq", "order", "limit"]) query[method] = vi.fn(() => query);
  const resolve = () => {
    const result = takeResult(table, operation?.kind ?? "select");
    if (selectedAfterWrite && result.data === null && !result.error) {
      return { data: { id: "group-created" }, error: null };
    }
    return result;
  };
  query.single = vi.fn(async () => resolve());
  Object.defineProperty(query, "then", {
    value: (resolvePromise: any, rejectPromise: any) =>
      Promise.resolve(resolve()).then(resolvePromise, rejectPromise),
  });
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(queryFor), rpc: mocks.rpc },
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfilesByIds: vi.fn() }));
vi.mock("@/components/MatchDutiesDialog", () => ({ MatchDutiesDialog: () => null }));
vi.mock("@/components/QuickSetupDutyDialog", () => ({ QuickSetupDutyDialog: () => null }));
vi.mock("@/components/ManualMatchDialog", () => ({ ManualMatchDialog: () => null }));
vi.mock("@/components/pitch/PitchBoard", () => ({ default: () => null }));

async function renderManager(isAdmin = true) {
  const { EventGroupsManager } = await import("./EventGroupsManager");
  render(<EventGroupsManager eventId="event-1" miniLeagueId="league-1" isAdmin={isAdmin} />);
  expect(mocks.mutations).toHaveLength(mutationNames.length);
}

function mutation(name: string) {
  return mocks.mutations.slice(-mutationNames.length)[mutationNames.indexOf(name)];
}

describe("EventGroupsManager business-operation characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutations = [];
    mocks.operations = [];
    mocks.results = {};
    mocks.groups = [];
    mocks.allPlayers = [];
    mocks.eventRsvps = [];
    mocks.previousEvents = [];
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("creates an event-scoped match before assigning its two teams", async () => {
    await renderManager();

    await mutation("createGroup").mutationFn({
      name: "Pitch One",
      pitchName: "North",
      teamAPlayerIds: ["player-a", "player-b"],
      teamBPlayerIds: ["player-c"],
    });

    expect(mocks.operations).toEqual([
      {
        table: "event_groups",
        kind: "insert",
        payload: {
          event_id: "event-1",
          name: "Pitch One",
          pitch_name: "North",
          display_order: 1,
          team_a_color: "#111111",
          team_b_color: "#eeeeee",
        },
        filters: [],
      },
      {
        table: "event_group_players",
        kind: "insert",
        payload: [
          { event_id: "event-1", group_id: "group-created", player_id: "player-a", team: "a" },
          { event_id: "event-1", group_id: "group-created", player_id: "player-b", team: "a" },
          { event_id: "event-1", group_id: "group-created", player_id: "player-c", team: "b" },
        ],
        filters: [],
      },
    ]);
  });

  it("does not assign players when creating the parent group is denied", async () => {
    mocks.results["event_groups:insert"] = [{ data: null, error: new Error("group denied") }];
    await renderManager();

    await expect(mutation("createGroup").mutationFn({
      name: "Denied",
      pitchName: "",
      teamAPlayerIds: ["player-a"],
      teamBPlayerIds: [],
    })).rejects.toThrow("group denied");

    expect(mocks.operations.map((operation) => operation.table)).toEqual(["event_groups"]);
  });

  it("reports assignment failure instead of treating a partially created match as success", async () => {
    mocks.results["event_group_players:insert"] = [{ data: null, error: new Error("assignment denied") }];
    await renderManager();

    await expect(mutation("createGroup").mutationFn({
      name: "Partial",
      pitchName: "",
      teamAPlayerIds: ["player-a"],
      teamBPlayerIds: [],
    })).rejects.toThrow("assignment denied");
  });

  it("deletes only the selected group and propagates a permission failure", async () => {
    mocks.results["event_groups:delete"] = [{ data: null, error: new Error("delete denied") }];
    await renderManager();

    await expect(mutation("deleteGroup").mutationFn("group-2")).rejects.toThrow("delete denied");
    expect(mocks.operations).toEqual([{
      table: "event_groups",
      kind: "delete",
      filters: [["id", "group-2"]],
    }]);
  });

  it("updates only the selected assignment when moving within one match", async () => {
    await renderManager();

    await mutation("movePlayer").mutationFn({
      playerId: "player-a",
      fromGroupId: "group-1",
      toGroupId: "group-1",
      toTeam: "b",
    });

    expect(mocks.operations).toEqual([{
      table: "event_group_players",
      kind: "update",
      payload: { team: "b" },
      filters: [["group_id", "group-1"], ["player_id", "player-a"]],
    }]);
  });

  it("moves across matches through the exact atomic RPC contract", async () => {
    await renderManager();

    await mutation("movePlayer").mutationFn({
      playerId: "player-a",
      fromGroupId: "group-1",
      toGroupId: "group-2",
      toTeam: "a",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("move_event_group_player", {
      p_player_id: "player-a",
      p_from_group_id: "group-1",
      p_to_group_id: "group-2",
      p_to_team: "a",
    });
    expect(mocks.operations).toHaveLength(0);
  });

  it("propagates an atomic cross-match move failure rather than reporting success", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("target denied") });
    await renderManager();

    await expect(mutation("movePlayer").mutationFn({
      playerId: "player-a",
      fromGroupId: "group-1",
      toGroupId: "group-2",
      toTeam: "a",
    })).rejects.toThrow("target denied");
    expect(mocks.operations).toHaveLength(0);
  });

  it("stops deleting all matches and reports the first rejected deletion", async () => {
    mocks.groups = [
      { id: "group-1", name: "One", players: [] },
      { id: "group-2", name: "Two", players: [] },
    ];
    mocks.results["event_groups:delete"] = [{ data: null, error: new Error("delete denied") }];
    await renderManager();

    await expect(mutation("deleteAllGroups").mutationFn()).rejects.toThrow("delete denied");
    expect(mocks.operations).toHaveLength(1);
  });

  it("uses the atomic swap RPC and propagates its failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("swap denied") });
    await renderManager();

    await expect(mutation("swapPlayers").mutationFn({
      player1Id: "player-a",
      player1GroupId: "group-1",
      player1Team: "a",
      player2Id: "player-b",
      player2GroupId: "group-2",
      player2Team: "b",
    })).rejects.toThrow("swap denied");
    expect(mocks.rpc).toHaveBeenCalledWith("swap_event_group_players", {
      p_player1_id: "player-a",
      p_player1_group_id: "group-1",
      p_player1_team: "a",
      p_player2_id: "player-b",
      p_player2_group_id: "group-2",
      p_player2_team: "b",
    });
    expect(mocks.operations).toHaveLength(0);
  });

  it("auto-generates one balanced match through one atomic replacement request", async () => {
    mocks.allPlayers = ["a", "b", "c", "d"].map((id, index) => ({
      id: `player-${id}`,
      name: `Player ${id}`,
      ability_rating: 4 - index,
      parent_user_id: null,
      child_id: null,
    }));
    mocks.eventRsvps = mocks.allPlayers.map((player) => ({
      user_id: null,
      child_id: null,
      mini_league_player_id: player.id,
    }));
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "replace_event_groups"
        ? { data: ["generated-group"], error: null }
        : { data: null, error: null });
    await renderManager();

    const result = await mutation("autoGenerate").mutationFn();

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("replace_event_groups", {
      p_event_id: "event-1",
      p_delete_existing: false,
      p_groups: [{
        name: "Match 1",
        ability_band: "Advanced",
        pitch_name: "Pitch 1",
        display_order: 1,
        team_a_color: "#111111",
        team_b_color: "#eeeeee",
        players: [
          { player_id: "player-a", team: "a" },
          { player_id: "player-b", team: "a" },
          { player_id: "player-c", team: "b" },
          { player_id: "player-d", team: "b" },
        ],
      }],
    });
    expect(result).toEqual({
      numCreated: 1,
      matchIds: ["generated-group"],
      matchPlayerIds: [["player-a", "player-b", "player-c", "player-d"]],
    });
  });

  it("does not distribute duties after atomic generation is rejected", async () => {
    mocks.allPlayers = ["a", "b", "c", "d"].map((id) => ({
      id: `player-${id}`,
      name: `Player ${id}`,
      ability_rating: 3,
      parent_user_id: null,
      child_id: null,
    }));
    mocks.eventRsvps = mocks.allPlayers.map((player) => ({ mini_league_player_id: player.id }));
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("generation denied") });
    await renderManager();

    await expect(mutation("autoGenerate").mutationFn()).rejects.toThrow("generation denied");
    expect(mocks.operations).toHaveLength(0);
  });

  it("copies eligible players from a previous round through one atomic request", async () => {
    const user = userEvent.setup();
    mocks.groups = [{
      id: "existing-group",
      name: "Existing",
      pitch_name: null,
      display_order: 1,
      team_a_color: "#111111",
      team_b_color: "#eeeeee",
      ability_band: null,
      players: [],
    }];
    mocks.previousEvents = [{ id: "previous-event", title: "Previous Round", event_date: "2099-01-01" }];
    mocks.results["rsvps:select"] = [{
      data: [{ mini_league_player_id: "player-a" }], error: null,
    }];
    mocks.results["event_groups:select"] = [{
      data: [{
        id: "previous-group",
        name: "Previous Match",
        ability_band: "Advanced",
        pitch_name: "Pitch 4",
        display_order: 4,
        team_a_color: "#123456",
        team_b_color: "#abcdef",
      }],
      error: null,
    }];
    mocks.results["event_group_players:select"] = [{
      data: [
        { player_id: "player-a", team: "a" },
        { player_id: "player-not-going", team: "b" },
      ],
      error: null,
    }];
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "replace_event_groups"
        ? { data: ["copied-group"], error: null }
        : { data: null, error: null });
    await renderManager();

    const menuButton = document.querySelector("svg.lucide-ellipsis")?.closest("button");
    expect(menuButton).not.toBeNull();
    await user.click(menuButton!);
    await user.click(await screen.findByText("Copy from Previous"));
    await user.click(await screen.findByText("Previous Round"));

    await mutation("copyPrevious").mutationFn();

    expect(mocks.rpc).toHaveBeenCalledWith("replace_event_groups", {
      p_event_id: "event-1",
      p_delete_existing: false,
      p_groups: [{
        name: "Previous Match",
        ability_band: "Advanced",
        pitch_name: "Pitch 4",
        display_order: 4,
        team_a_color: "#123456",
        team_b_color: "#abcdef",
        players: [{ player_id: "player-a", team: "a" }],
      }],
    });
    expect(mocks.operations.filter((operation) => operation.kind === "insert")).toEqual([]);
  });

  it("shows generated matches to members without exposing group-management controls", async () => {
    mocks.groups = [{
      id: "group-1",
      name: "Pitch One",
      pitch_name: "North",
      display_order: 1,
      team_a_color: "#111111",
      team_b_color: "#eeeeee",
      ability_band: null,
      players: [
        { id: "player-a", name: "Alex", team: "a", ability_rating: 3 },
        { id: "player-b", name: "Bailey", team: "b", ability_rating: 3 },
      ],
    }];
    await renderManager(false);

    expect(screen.getByText("Pitch One")).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Bailey")).toBeInTheDocument();
    expect(screen.queryByText("Regenerate All")).not.toBeInTheDocument();
    expect(screen.queryByText(/Tap a player/)).not.toBeInTheDocument();
  });
});
