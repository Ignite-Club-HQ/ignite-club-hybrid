import { describe, expect, it } from "vitest";
import { isPlanPlayableFromPlayers } from "./validation";

type Player = {
  id: string;
  position: { x: number; y: number } | null;
};

const starter = (id: string): Player => ({ id, position: { x: 50, y: 50 } });
const bench = (id: string): Player => ({ id, position: null });
const sub = (
  playerOut: Player,
  playerIn: Player,
  time: number,
  half: 1 | 2 = 1,
  status: { executed?: boolean; skipped?: boolean } = {},
) => ({ playerOut, playerIn, time, half, ...status });

describe("AutoSub plan playability", () => {
  it("accepts a chronological chain that always swaps an on-pitch player for a bench player", () => {
    const a = starter("a");
    const b = starter("b");
    const c = bench("c");

    expect(isPlanPlayableFromPlayers(
      [a, b, c],
      [sub(a, c, 300), sub(c, a, 600)],
      1_200,
    )).toBe(true);
  });

  it("rejects substitutions containing a player who is no longer in the squad", () => {
    const a = starter("a");
    const b = bench("b");
    const removed = bench("removed");

    expect(isPlanPlayableFromPlayers([a, b], [sub(a, removed, 300)], 1_200)).toBe(false);
  });

  it("rejects taking off a bench player or bringing on a player already on the pitch", () => {
    const a = starter("a");
    const b = starter("b");
    const c = bench("c");

    expect(isPlanPlayableFromPlayers([a, b, c], [sub(c, a, 300)], 1_200)).toBe(false);
    expect(isPlanPlayableFromPlayers([a, b, c], [sub(a, b, 300)], 1_200)).toBe(false);
  });

  it("ignores completed and skipped events when validating the remaining plan", () => {
    const a = starter("a");
    const b = bench("b");

    expect(isPlanPlayableFromPlayers(
      [a, b],
      [sub(b, a, 100, 1, { executed: true }), sub(b, a, 200, 1, { skipped: true }), sub(a, b, 300)],
      1_200,
    )).toBe(true);
  });

  it("orders second-half events after every first-half event even when their clock time is lower", () => {
    const a = starter("a");
    const b = bench("b");

    expect(isPlanPlayableFromPlayers(
      [a, b],
      [sub(b, a, 60, 2), sub(a, b, 1_100, 1)],
      1_200,
    )).toBe(true);
  });
});
