/**
 * repairPlan regression tests — cover both the composition-change repair
 * and the injury recalc paths, plus the orphan-detection helper.
 */
import { describe, it, expect } from "vitest";
import {
  findOrphanedReferences,
  repairForComposition,
  repairForInjury,
} from "./repairPlan";
import type { Player, SubstitutionEvent } from "../types";

const mkPlayer = (
  id: string,
  opts: { onPitch?: boolean; injured?: boolean; teamSide?: "a" | "b" } = {}
): Player =>
  ({
    id,
    name: id,
    position: opts.onPitch ?? true ? { x: 50, y: 50 } : null,
    isInjured: opts.injured ?? false,
    teamSide: opts.teamSide,
  } as Player);

const mkSub = (
  outId: string,
  inId: string,
  half: 1 | 2 = 1,
  time = 60,
  executed = false
): SubstitutionEvent => ({
  time,
  half,
  playerOut: mkPlayer(outId, { onPitch: true }),
  playerIn: mkPlayer(inId, { onPitch: false }),
  executed,
});

describe("findOrphanedReferences", () => {
  it("returns false when every referenced player still exists", () => {
    const players = [mkPlayer("A"), mkPlayer("B", { onPitch: false })];
    expect(findOrphanedReferences([mkSub("A", "B")], players)).toBe(false);
  });

  it("returns true when a remaining sub references a removed player", () => {
    const players = [mkPlayer("A")];
    expect(findOrphanedReferences([mkSub("A", "GHOST")], players)).toBe(true);
  });

  it("ignores executed subs (they describe past events)", () => {
    const players = [mkPlayer("A")];
    const executed = mkSub("A", "GHOST", 1, 60, true);
    expect(findOrphanedReferences([executed], players)).toBe(false);
  });

  it("does not cancel a plan when an unreferenced player leaves the match roster", () => {
    const players = [mkPlayer("A"), mkPlayer("B", { onPitch: false })];
    const plan = [mkSub("A", "B")];

    expect(findOrphanedReferences(plan, players)).toBe(false);
  });

  it("detects a removed player whether they were scheduled to come on or go off", () => {
    const remainingPlayers = [mkPlayer("A"), mkPlayer("B", { onPitch: false })];

    expect(findOrphanedReferences([mkSub("removed-out", "B")], remainingPlayers)).toBe(true);
    expect(findOrphanedReferences([mkSub("A", "removed-in")], remainingPlayers)).toBe(true);
  });
});

describe("repairForComposition", () => {
  it("noops on an empty plan", () => {
    expect(repairForComposition([], [mkPlayer("A")])).toEqual({ kind: "noop" });
  });

  it("noops when nothing remains to repair", () => {
    const executed = mkSub("A", "B", 1, 60, true);
    expect(repairForComposition([executed], [mkPlayer("A")])).toEqual({
      kind: "noop",
    });
  });

  it("requests regenerate when repair empties the plan but bench is healthy", () => {
    // Manual swap already moved A↔B before the plan ran — the only remaining
    // sub no longer matches the live pitch composition.
    const players = [
      mkPlayer("A", { onPitch: false }), // was on pitch, now bench
      mkPlayer("B", { onPitch: true }), // was bench, now on pitch
      mkPlayer("C", { onPitch: false }), // healthy bench
    ];
    const intent = repairForComposition([mkSub("A", "B")], players);
    // The sub A→B matches a swap already done; repair marks executed →
    // nothing remains → bench is healthy → regenerate.
    expect(intent.kind).toBe("regenerate");
  });

  it("returns a replace intent when remaining subs still resolve", () => {
    const players = [
      mkPlayer("A", { onPitch: true }),
      mkPlayer("B", { onPitch: false }),
    ];
    const intent = repairForComposition([mkSub("A", "B", 1, 600)], players);
    expect(intent.kind).toBe("replace");
    if (intent.kind === "replace") {
      expect(intent.reason).toBe("composition-changed");
    }
  });

  it("keeps the existing schedule valid when a late arrival joins the bench", () => {
    const planned = mkSub("A", "B", 1, 600);
    const players = [
      mkPlayer("A", { onPitch: true }),
      mkPlayer("B", { onPitch: false }),
      mkPlayer("late-arrival", { onPitch: false }),
    ];

    const intent = repairForComposition([planned], players);

    expect(intent.kind).toBe("replace");
    if (intent.kind === "replace") {
      expect(intent.executed).toEqual([]);
      expect(intent.remaining).toEqual([planned]);
    }
  });

  it("preserves completed and skipped history while repairing future substitutions", () => {
    const completed = { ...mkSub("A", "B", 1, 60, true), skipped: false };
    const skipped = { ...mkSub("C", "D", 1, 120, true), skipped: true };
    const future = mkSub("E", "F", 1, 600);
    const players = [
      mkPlayer("A", { onPitch: false }),
      mkPlayer("B", { onPitch: true }),
      mkPlayer("C", { onPitch: true }),
      mkPlayer("D", { onPitch: false }),
      mkPlayer("E", { onPitch: true }),
      mkPlayer("F", { onPitch: false }),
    ];

    const intent = repairForComposition([completed, skipped, future], players);

    expect(intent.kind).toBe("replace");
    if (intent.kind === "replace") {
      expect(intent.executed).toContainEqual(completed);
      expect(intent.executed).toContainEqual(skipped);
      expect(intent.remaining).toContainEqual(future);
    }
  });
});

describe("repairForInjury", () => {
  const baseArgs = {
    teamSize: 7,
    minutesPerHalfSecs: 25 * 60,
    currentElapsed: 300,
    currentHalf: 1 as const,
    rotateGkAtHalftime: false,
  };

  it("noops when nothing remains in the plan", () => {
    const intent = repairForInjury({
      ...baseArgs,
      plan: [mkSub("A", "B", 1, 60, true)],
      updatedPlayers: [mkPlayer("A")],
      injuredId: "A",
    });
    expect(intent).toEqual({ kind: "noop" });
  });

  it("strips injured player's pending subs when recalc collapses", () => {
    // Only one bench player remains and they're injured → recalc returns
    // empty, fallback path should strip injured's pending subs.
    const plan = [mkSub("A", "B"), mkSub("C", "D")];
    const players = [
      mkPlayer("A", { onPitch: true }),
      mkPlayer("B", { onPitch: false, injured: true }),
      mkPlayer("C", { onPitch: true }),
      mkPlayer("D", { onPitch: false }), // healthy bench
    ];
    const intent = repairForInjury({
      ...baseArgs,
      plan,
      updatedPlayers: players,
      injuredId: "B",
    });
    // We expect *some* replace intent; if recalc ran successfully it'll be
    // the normal path, otherwise injuryFallback. Either way A→B must be gone.
    expect(intent.kind).toBe("replace");
    if (intent.kind === "replace") {
      const stillReferencesB = intent.remaining.some(
        (s) => s.playerOut.id === "B" || s.playerIn.id === "B"
      );
      expect(stillReferencesB).toBe(false);
    }
  });

  it("never reintroduces the injured player into the replacement plan", () => {
    const executed = mkSub("A", "B", 1, 60, true);
    const pending = mkSub("C", "injured", 1, 600);
    const players = [
      mkPlayer("A", { onPitch: false }),
      mkPlayer("B", { onPitch: true }),
      mkPlayer("C", { onPitch: true }),
      mkPlayer("injured", { onPitch: false, injured: true }),
      mkPlayer("healthy-reserve", { onPitch: false }),
    ];

    const intent = repairForInjury({
      ...baseArgs,
      plan: [executed, pending],
      updatedPlayers: players,
      injuredId: "injured",
    });

    expect(intent.kind).toBe("replace");
    if (intent.kind === "replace") {
      expect(intent.executed).toEqual([executed]);
      expect(
        intent.remaining.some(
          (sub) => sub.playerIn.id === "injured" || sub.playerOut.id === "injured",
        ),
      ).toBe(false);
    }
  });
});
