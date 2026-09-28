import { describe, expect, it } from "vitest";
import { resolveExistingPlan } from "./existingPlan";

type Player = { id: string; position: { x: number; y: number } | null };
const starter = (id: string): Player => ({ id, position: { x: 50, y: 50 } });
const bench = (id: string): Player => ({ id, position: null });
const sub = (
  playerOut: Player,
  playerIn: Player,
  status: { executed?: boolean; skipped?: boolean } = {},
) => ({ half: 1 as const, time: 300, playerOut, playerIn, ...status });
const resolve = (players: Player[], existingPlan: ReturnType<typeof sub>[] | undefined, editMode = false) =>
  resolveExistingPlan({ players, existingPlan, editMode, halfDurationSeconds: 1_200 });

describe("AutoSub existing-plan admission", () => {
  it("reports no plan when none was saved", () => {
    expect(resolve([starter("a"), bench("b")], undefined)).toEqual({
      plan: undefined, hasRemainingPlan: false, isPlayable: false, reason: "none",
    });
  });

  it("does not revive executed or skipped history", () => {
    const a = starter("a");
    const b = bench("b");
    const result = resolve([a, b], [sub(a, b, { executed: true }), sub(a, b, { skipped: true })], true);
    expect(result).toMatchObject({ plan: undefined, hasRemainingPlan: false, reason: "completed" });
  });

  it("retains the same playable plan in forecast mode", () => {
    const a = starter("a");
    const b = bench("b");
    const plan = [sub(a, b)];
    const result = resolve([a, b], plan);
    expect(result).toMatchObject({ hasRemainingPlan: true, isPlayable: true, reason: "playable" });
    expect(result.plan).toBe(plan);
  });

  it("rejects a forecast plan referencing a removed player so regeneration can run", () => {
    const a = starter("a");
    const result = resolve([a, bench("b")], [sub(a, bench("removed"))]);
    expect(result).toMatchObject({ plan: undefined, hasRemainingPlan: true, isPlayable: false, reason: "stale" });
  });

  it("rejects a forecast plan invalidated by a manual lineup change", () => {
    const a = starter("a");
    const b = starter("b");
    expect(resolve([a, b], [sub(a, b)])).toMatchObject({ plan: undefined, reason: "stale" });
  });

  it("retains a stale plan in edit mode for the repair workflow", () => {
    const a = starter("a");
    const plan = [sub(a, bench("removed"))];
    const result = resolve([a], plan, true);
    expect(result).toMatchObject({ hasRemainingPlan: true, isPlayable: false, reason: "edit-repair" });
    expect(result.plan).toBe(plan);
  });

  it("ignores invalid completed history when future work remains playable", () => {
    const a = starter("a");
    const b = bench("b");
    const plan = [sub(a, bench("removed"), { executed: true }), sub(a, b)];
    expect(resolve([a, b], plan)).toMatchObject({ plan, isPlayable: true, reason: "playable" });
  });
});
