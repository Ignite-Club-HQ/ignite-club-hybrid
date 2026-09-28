import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Player } from "../types";
import { usePitchBoardPlayerPlacement } from "./usePitchBoardPlayerPlacement";

const player = (
  id: string,
  overrides: Partial<Player> = {},
): Player => ({
  id,
  name: id,
  position: null,
  ...overrides,
});

describe("pitchboard player placement", () => {
  it("assigns specialists before flexible players and benches overflow", () => {
    const { result } = renderHook(() => usePitchBoardPlayerPlacement());
    const placed = result.current.autoPlacePlayersOnPitch([
      player("flex"),
      player("forward", { assignedPositions: ["FWD"] }),
      player("keeper", { assignedPositions: ["GK"] }),
      ...Array.from({ length: 5 }, (_, index) => player(`extra-${index}`)),
    ], "7", 0);

    expect(placed.find((candidate) => candidate.id === "keeper")).toMatchObject({
      currentPitchPosition: "GK",
      position: { x: 50, y: 90 },
    });
    expect(placed.find((candidate) => candidate.id === "forward")).toMatchObject({
      currentPitchPosition: "FWD",
      position: { x: 50, y: 20 },
    });
    expect(placed.filter((candidate) => candidate.position !== null)).toHaveLength(7);
    expect(placed.filter((candidate) => candidate.position === null)).toHaveLength(1);
  });

  it("places mini-league teams on opposing pitch halves and benches unassigned players", () => {
    const { result } = renderHook(() => usePitchBoardPlayerPlacement());
    const placed = result.current.autoPlaceMiniLeaguePlayers([
      player("a", { teamSide: "a" }),
      player("b", { teamSide: "b" }),
      player("unassigned"),
    ], "3");

    expect(placed.find((candidate) => candidate.id === "a")?.position?.y).toBeGreaterThanOrEqual(50);
    expect(placed.find((candidate) => candidate.id === "b")?.position?.y).toBeLessThanOrEqual(50);
    expect(placed.find((candidate) => candidate.id === "unassigned")?.position).toBeNull();
  });

  it("preserves bench membership while applying new mini-league formation positions", () => {
    const { result } = renderHook(() => usePitchBoardPlayerPlacement());
    const placed = result.current.autoPlaceMiniLeaguePlayers([
      player("a-pitch", { teamSide: "a", position: { x: 20, y: 70 } }),
      player("a-bench", { teamSide: "a" }),
      player("b-pitch", { teamSide: "b", position: { x: 80, y: 30 } }),
      player("b-bench", { teamSide: "b" }),
    ], "3", true, 1, true);

    expect(placed.find((candidate) => candidate.id === "a-pitch")?.position).not.toBeNull();
    expect(placed.find((candidate) => candidate.id === "b-pitch")?.position).not.toBeNull();
    expect(placed.find((candidate) => candidate.id === "a-bench")?.position).toBeNull();
    expect(placed.find((candidate) => candidate.id === "b-bench")?.position).toBeNull();
  });

  it("uses existing on-pitch order before bench players when changing mini-league team size", () => {
    const { result } = renderHook(() => usePitchBoardPlayerPlacement());
    const placed = result.current.autoPlaceMiniLeaguePlayers([
      player("a-bench", { teamSide: "a" }),
      player("a-pitch", { teamSide: "a", position: { x: 50, y: 70 } }),
      player("a-extra", { teamSide: "a" }),
      player("a-fourth", { teamSide: "a" }),
    ], "3", true);

    expect(placed.find((candidate) => candidate.id === "a-pitch")?.position).not.toBeNull();
    expect(placed.find((candidate) => candidate.id === "a-bench")?.position).not.toBeNull();
    expect(placed.find((candidate) => candidate.id === "a-extra")?.position).not.toBeNull();
    expect(placed.find((candidate) => candidate.id === "a-fourth")?.position).toBeNull();
  });
});
