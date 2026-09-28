import { describe, expect, it } from "vitest";
import { filterBenchPlayers } from "./PitchBoardBenchPlayers";
import type { Player } from "./types";

const players: Player[] = [
  { id: "a", name: "Team A", position: null, teamSide: "a", assignedPositions: ["DEF"] },
  { id: "b", name: "Team B", position: null, teamSide: "b", assignedPositions: ["MID"] },
  { id: "any", name: "Utility", position: null, assignedPositions: [] },
];

const baseInput = {
  players,
  miniLeagueTeams: {
    teamAPlayerIds: ["a"],
    teamBPlayerIds: ["b"],
    teamAColor: "#111",
    teamBColor: "#222",
  },
  selectedTeam: "both" as const,
  subMode: false,
  selectedOnPitch: null,
  validBenchPlayerIds: new Set<string>(),
  positionFilter: null,
};

describe("filterBenchPlayers", () => {
  it("preserves the unfiltered bench roster and team selection", () => {
    expect(filterBenchPlayers(baseInput).map((player) => player.id)).toEqual(["a", "b", "any"]);
    expect(filterBenchPlayers({ ...baseInput, selectedTeam: "a" }).map((player) => player.id)).toEqual(["a"]);
  });

  it("uses valid substitution targets when a pitch player is selected", () => {
    expect(filterBenchPlayers({
      ...baseInput,
      subMode: true,
      selectedOnPitch: "pitch-player",
      validBenchPlayerIds: new Set(["b"]),
    }).map((player) => player.id)).toEqual(["b"]);
  });

  it("keeps utility players visible for a position filter", () => {
    expect(filterBenchPlayers({
      ...baseInput,
      positionFilter: "DEF",
    }).map((player) => player.id)).toEqual(["a", "any"]);
  });
});
