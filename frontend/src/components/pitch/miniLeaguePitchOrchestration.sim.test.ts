import { describe, expect, it } from "vitest";
import { createMiniLeagueSubPlan } from "./AutoSubPlanDialog";
import { recalculateRemainingPlanTeamAware } from "./pitchStateUtils";
import type { MiniLeagueTeams, Player } from "./types";

function player(id: string, side: "a" | "b", onPitch: boolean, role: "GK" | "DEF" | "MID" | "FWD"): Player {
  return {
    id, name: id, teamSide: side,
    position: onPitch ? { x: side === "a" ? 30 : 70, y: 50 } : null,
    currentPitchPosition: onPitch ? role : undefined,
    assignedPositions: role === "GK" ? ["GK"] : ["DEF", "MID", "FWD"],
    minutesPlayed: 0,
  };
}

function twoTeams() {
  return [
    player("a-gk", "a", true, "GK"), player("a-1", "a", true, "DEF"),
    player("a-2", "a", true, "MID"), player("a-3", "a", true, "FWD"),
    player("a-bench", "a", false, "MID"),
    player("b-gk", "b", true, "GK"), player("b-1", "b", true, "DEF"),
    player("b-2", "b", true, "MID"), player("b-3", "b", true, "FWD"),
    player("b-bench", "b", false, "MID"),
  ];
}

const teams: MiniLeagueTeams = {
  teamAPlayerIds: ["a-gk", "a-1", "a-2", "a-3", "a-bench"],
  teamBPlayerIds: ["b-gk", "b-1", "b-2", "b-3", "b-bench"],
  teamAColor: "#a00", teamBColor: "#00a", teamAName: "Reds", teamBName: "Blues",
};

describe("mini-league two-team pitchboard simulation", () => {
  it("creates independent autosub plans that never exchange players between teams", () => {
    const players = twoTeams();
    const plan = createMiniLeagueSubPlan(
      players, 4, 20 * 60, 2, false, false, false,
      0, 1, teams, undefined, 5,
    );
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.some((sub) => sub.playerOut.teamSide === "a")).toBe(true);
    expect(plan.some((sub) => sub.playerOut.teamSide === "b")).toBe(true);
    for (const sub of plan) {
      expect(sub.playerIn.teamSide).toBe(sub.playerOut.teamSide);
      if (sub.positionSwap) expect(sub.positionSwap.player.teamSide).toBe(sub.playerOut.teamSide);
    }
  });

  it("merges both teams into one deterministic chronological notification timeline", () => {
    const players = twoTeams();
    const first = createMiniLeagueSubPlan(players, 4, 20 * 60, 2, false, false, false, 0, 1, teams);
    const second = createMiniLeagueSubPlan(players, 4, 20 * 60, 2, false, false, false, 0, 1, teams);
    const signature = (plan: typeof first) => plan.map((sub) => [sub.half, sub.time, sub.playerOut.id, sub.playerIn.id]);
    expect(signature(second)).toEqual(signature(first));
    const absolute = first.map((sub) => (sub.half - 1) * 20 * 60 + sub.time);
    expect(absolute).toEqual([...absolute].sort((a, b) => a - b));
  });

  it("repairs a skipped Team A substitution without introducing Team B into Team A movements", () => {
    const players = twoTeams();
    const original = createMiniLeagueSubPlan(players, 4, 20 * 60, 2, false, false, false, 0, 1, teams);
    const skipped = original.find((sub) => sub.playerOut.teamSide === "a");
    expect(skipped).toBeDefined();
    const repaired = recalculateRemainingPlanTeamAware(players, 4, 20 * 60, skipped!.time, skipped!.half, skipped!, false);
    for (const sub of repaired) {
      expect(sub.playerIn.teamSide).toBe(sub.playerOut.teamSide);
    }
    expect(repaired).toEqual([...repaired].sort((a, b) => a.half - b.half || a.time - b.time));
  });

  it("does not pull an unassigned mini-league player into either team's autosubs", () => {
    const unassigned: Player = { id: "unassigned", name: "Unassigned", position: null, assignedPositions: ["MID"] };
    const plan = createMiniLeagueSubPlan([...twoTeams(), unassigned], 4, 20 * 60, 2, false, false, false, 0, 1, teams);
    expect(plan.some((sub) => sub.playerIn.id === "unassigned" || sub.playerOut.id === "unassigned")).toBe(false);
  });
});
