import { describe, expect, it } from "vitest";
import {
  findNextDueSub as findNextDueNetballSub,
  pickLikeForLikeBenchPlayer as pickNetballBenchPlayer,
  applyLineup as applyNetballLineup,
  generateTimeBasedRotationPlan as generateNetballTimeBasedRotationPlan,
  generateQuarterBreakRotationPlan as generateNetballQuarterBreakRotationPlan,
  getBench as getNetballBench,
  getOnCourt as getNetballOnCourt,
  transitionPosition as transitionNetballPosition,
  classifySwapFit,
  suggestQuarterLineup,
  isPositionAllowedForPlayer as isNetballPositionAllowedForPlayer,
  getSubKey as getNetballSubKey,
  type NetballPlayer,
  type NetballSubEvent,
  type Quarter as NetballQuarter,
  type QuarterLineup as NetballQuarterLineup,
} from "../src/lab/archivedSports/netballHelpers.local";
import {
  findNextDueSub as findNextDueBasketballSub,
  pickLikeForLikeBenchPlayer as pickBasketballBenchPlayer,
  applyLineup as applyBasketballLineup,
  generateTimeBasedRotationPlan as generateBasketballTimeBasedRotationPlan,
  generateQuarterBreakRotationPlan as generateBasketballQuarterBreakRotationPlan,
  getBench as getBasketballBench,
  getOnCourt as getBasketballOnCourt,
  transitionPosition as transitionBasketballPosition,
  getSubKey as getBasketballSubKey,
  type BasketballPlayer,
  type BasketballSubEvent,
  type Quarter as BasketballQuarter,
  type QuarterLineup as BasketballQuarterLineup,
} from "../src/lab/archivedSports/basketballHelpers.local";

const mkNetballPlayer = (
  id: string,
  position: NetballPlayer["position"] = null,
  minutesPlayed = 0,
  preferred?: NetballPlayer["preferredPositions"]
): NetballPlayer => ({
  id,
  name: `Player ${id}`,
  position,
  minutesPlayed,
  preferredPositions: preferred,
});

const mkNetballSub = (
  q: NetballQuarter,
  time: number,
  outId: string,
  inId: string,
  position: NetballSubEvent["position"] = "GS",
  flags: Partial<NetballSubEvent> = {}
): NetballSubEvent => ({
  quarter: q,
  time,
  playerOut: mkNetballPlayer(outId, position),
  playerIn: mkNetballPlayer(inId),
  position,
  ...flags,
});

describe("netballHelpers.local", () => {
  describe("findNextDueSub — N1 cross-quarter scoping", () => {
    it("returns a sub due in the current quarter", () => {
      const plan = [mkNetballSub(2, 120, "a", "b")];
      expect(findNextDueNetballSub(plan, 2, 121)?.playerOut.id).toBe("a");
    });

    it("does NOT cascade un-executed Q1 subs into Q2 (regression guard)", () => {
      const plan = [mkNetballSub(1, 300, "a", "b")];
      expect(findNextDueNetballSub(plan, 2, 0)).toBeUndefined();
      expect(findNextDueNetballSub(plan, 2, 600)).toBeUndefined();
    });

    it("ignores executed and skipped subs", () => {
      const plan = [
        mkNetballSub(1, 60, "a", "b", "GS", { executed: true }),
        mkNetballSub(1, 120, "c", "d", "GS", { skipped: true }),
        mkNetballSub(1, 180, "e", "f"),
      ];
      expect(findNextDueNetballSub(plan, 1, 200)?.playerOut.id).toBe("e");
    });
  });

  describe("classifySwapFit — court zone rules", () => {
    it("classifies exact preferred-position match", () => {
      const p = mkNetballPlayer("a", null, 0, ["GS"]);
      expect(classifySwapFit(p, "GS")).toBe("exact");
    });

    it("classifies zone overlap as 'zone'", () => {
      const ga = mkNetballPlayer("a", null, 0, ["GA"]);
      expect(classifySwapFit(ga, "GS")).toBe("zone");
    });

    it("returns 'any' when no preferred positions are set", () => {
      expect(classifySwapFit(mkNetballPlayer("a"), "GK")).toBe("any");
    });

    it("returns 'violation' when preferred positions share no zone", () => {
      const gk = mkNetballPlayer("a", null, 0, ["GK"]);
      expect(classifySwapFit(gk, "GS")).toBe("violation");
    });
  });

  describe("isPositionAllowedForPlayer", () => {
    it("allows any position when player has no preferences", () => {
      expect(isNetballPositionAllowedForPlayer(mkNetballPlayer("a"), "GK")).toBe(true);
    });

    it("allows preferred positions only when preferences are set", () => {
      const p = mkNetballPlayer("a", null, 0, ["GS", "GA"]);
      expect(isNetballPositionAllowedForPlayer(p, "GS")).toBe(true);
      expect(isNetballPositionAllowedForPlayer(p, "GK")).toBe(false);
    });
  });

  describe("pickLikeForLikeBenchPlayer", () => {
    it("prefers exact preferred-position match", () => {
      const bench = [
        mkNetballPlayer("a", null, 0, ["WD"]),
        mkNetballPlayer("b", null, 0, ["GS"]),
        mkNetballPlayer("c", null, 0, ["GA"]),
      ];
      expect(pickNetballBenchPlayer("GS", bench)?.id).toBe("b");
    });

    it("falls back to zone overlap when no exact match", () => {
      const bench = [
        mkNetballPlayer("a", null, 0, ["GK"]),
        mkNetballPlayer("b", null, 0, ["GA"]),
      ];
      expect(pickNetballBenchPlayer("GS", bench)?.id).toBe("b");
    });

    it("excludes injured + explicitly excluded players", () => {
      const bench = [
        { ...mkNetballPlayer("inj", null, 0, ["GS"]), isInjured: true },
        mkNetballPlayer("ok", null, 0, ["GS"]),
      ];
      expect(pickNetballBenchPlayer("GS", bench)?.id).toBe("ok");
      expect(pickNetballBenchPlayer("GS", bench, ["ok"])).toBeUndefined();
    });
  });

  describe("transitionPosition + applyLineup", () => {
    it("stamps lastBenchedAt when going on-court → bench", () => {
      const onCourt = mkNetballPlayer("a", "GS");
      const next = transitionNetballPosition(onCourt, null, 1_700_000_000_000);
      expect(next.position).toBeNull();
      expect(next.lastBenchedAt).toBe(1_700_000_000_000);
    });

    it("clears lastBenchedAt when coming back on", () => {
      const onBench: NetballPlayer = { ...mkNetballPlayer("a"), lastBenchedAt: 123 };
      const next = transitionNetballPosition(onBench, "GA");
      expect(next.position).toBe("GA");
      expect(next.lastBenchedAt).toBeNull();
    });

    it("applyLineup honours assignments + benches the rest", () => {
      const players = [
        mkNetballPlayer("a", "GS"),
        mkNetballPlayer("b", "GA"),
        mkNetballPlayer("c"),
      ];
      const lineup: NetballQuarterLineup = {
        quarter: 2,
        assignments: { GS: "c", GA: "a" },
        createdAt: Date.now(),
      };
      const next = applyNetballLineup(players, lineup);
      expect(next.find((p) => p.id === "c")?.position).toBe("GS");
      expect(next.find((p) => p.id === "a")?.position).toBe("GA");
      expect(next.find((p) => p.id === "b")?.position).toBeNull();
    });
  });

  describe("Rotation plan generators — honour periodType", () => {
    const makeRoster = (): NetballPlayer[] => [
      mkNetballPlayer("p1", "GS", 0, ["GS"]),
      mkNetballPlayer("p2", "GA", 0, ["GA"]),
      mkNetballPlayer("p3", "WA", 0, ["WA"]),
      mkNetballPlayer("p4", "C", 0, ["C"]),
      mkNetballPlayer("p5", "WD", 0, ["WD"]),
      mkNetballPlayer("p6", "GD", 0, ["GD"]),
      mkNetballPlayer("p7", "GK", 0, ["GK"]),
      mkNetballPlayer("b1", null, 0, ["GS", "GA"]),
      mkNetballPlayer("b2", null, 0, ["WA", "C"]),
    ];

    it("time-based plan stays within visible periods (halves)", () => {
      const plan = generateNetballTimeBasedRotationPlan(makeRoster(), 4, 15, "halves");
      for (const s of plan) expect([1, 3]).toContain(s.quarter);
    });

    it("quarter-break plan skips slot 1 (no pre-tipoff break)", () => {
      const plan = generateNetballQuarterBreakRotationPlan(makeRoster(), 2, "quarters");
      expect(plan.every((s) => s.quarter !== 1)).toBe(true);
    });

    it("quarter-break plan in halves only plans for slot 3", () => {
      const plan = generateNetballQuarterBreakRotationPlan(makeRoster(), 2, "halves");
      for (const s of plan) expect(s.quarter).toBe(3);
    });
  });

  describe("suggestQuarterLineup — fairness + zone safety", () => {
    it("respects existing locked assignments", () => {
      const players = [
        mkNetballPlayer("a", null, 0, ["GS"]),
        mkNetballPlayer("b", null, 0, ["GS"]),
      ];
      const result = suggestQuarterLineup(players, { GS: "a" });
      expect(result.GS).toBe("a");
    });

    it("never assigns a player to a position that violates their zones", () => {
      const players = [
        mkNetballPlayer("gk-only", null, 0, ["GK"]),
        mkNetballPlayer("gs-only", null, 0, ["GS"]),
      ];
      const result = suggestQuarterLineup(players);
      expect(result.GS).not.toBe("gk-only");
      expect(result.GK).not.toBe("gs-only");
    });

    it("prefers lower-minutes players when fit is equal", () => {
      const players = [
        mkNetballPlayer("tired", null, 600, ["GS", "GA"]),
        mkNetballPlayer("fresh", null, 0, ["GS", "GA"]),
      ];
      const result = suggestQuarterLineup(players);
      expect(result.GS).toBe("fresh");
    });
  });

  describe("getSubKey + getBench / getOnCourt", () => {
    it("getSubKey is stable across object identity", () => {
      const a = mkNetballSub(1, 60, "x", "y", "GS");
      const b = mkNetballSub(1, 60, "x", "y", "GS");
      expect(getNetballSubKey(a)).toBe(getNetballSubKey(b));
    });

    it("partitions on-court and bench", () => {
      const players = [mkNetballPlayer("a", "GS"), mkNetballPlayer("b"), mkNetballPlayer("c", "C")];
      expect(getNetballBench(players).map((p) => p.id)).toEqual(["b"]);
      expect(getNetballOnCourt(players).map((p) => p.id).sort()).toEqual(["a", "c"]);
    });
  });
});

const mkBasketballPlayer = (
  id: string,
  position: BasketballPlayer["position"] = null,
  minutesPlayed = 0,
  preferred?: BasketballPlayer["preferredPositions"]
): BasketballPlayer => ({
  id,
  name: `Player ${id}`,
  position,
  minutesPlayed,
  preferredPositions: preferred,
});

const mkBasketballSub = (
  q: BasketballQuarter,
  time: number,
  outId: string,
  inId: string,
  position: BasketballSubEvent["position"] = "PG",
  flags: Partial<BasketballSubEvent> = {}
): BasketballSubEvent => ({
  quarter: q,
  time,
  playerOut: mkBasketballPlayer(outId, position),
  playerIn: mkBasketballPlayer(inId),
  position,
  ...flags,
});

describe("basketballHelpers.local", () => {
  describe("findNextDueSub — B1/N1 cross-quarter scoping", () => {
    it("returns a sub due in the current quarter", () => {
      const plan = [mkBasketballSub(2, 120, "a", "b")];
      const due = findNextDueBasketballSub(plan, 2, 121);
      expect(due?.playerOut.id).toBe("a");
    });

    it("does NOT cascade un-executed Q1 subs into Q2 (regression guard)", () => {
      const plan = [mkBasketballSub(1, 300, "a", "b")];
      expect(findNextDueBasketballSub(plan, 2, 0)).toBeUndefined();
      expect(findNextDueBasketballSub(plan, 2, 600)).toBeUndefined();
    });

    it("ignores executed and skipped subs", () => {
      const plan = [
        mkBasketballSub(1, 60, "a", "b", "PG", { executed: true }),
        mkBasketballSub(1, 120, "c", "d", "PG", { skipped: true }),
        mkBasketballSub(1, 180, "e", "f"),
      ];
      expect(findNextDueBasketballSub(plan, 1, 200)?.playerOut.id).toBe("e");
    });

    it("returns undefined when nothing is due yet", () => {
      const plan = [mkBasketballSub(1, 300, "a", "b")];
      expect(findNextDueBasketballSub(plan, 1, 100)).toBeUndefined();
    });
  });

  describe("pickLikeForLikeBenchPlayer — fairness + eligibility", () => {
    const bench = [
      mkBasketballPlayer("low", null, 60, ["PG"]),
      mkBasketballPlayer("mid", null, 120, ["PG"]),
      mkBasketballPlayer("high", null, 240, ["PG"]),
    ];

    it("prefers the lowest-minutes preferred-position player", () => {
      const pick = pickBasketballBenchPlayer("PG", bench);
      expect(pick?.id).toBe("low");
    });

    it("falls back to lowest-minutes when no preferred match", () => {
      const generic = [
        mkBasketballPlayer("a", null, 240),
        mkBasketballPlayer("b", null, 60),
        mkBasketballPlayer("c", null, 180),
      ];
      expect(pickBasketballBenchPlayer("C", generic)?.id).toBe("b");
    });

    it("excludes injured / fouled-out / explicitly excluded players", () => {
      const pool = [
        { ...mkBasketballPlayer("inj", null, 0), isInjured: true },
        { ...mkBasketballPlayer("fo", null, 0), isFouledOut: true },
        mkBasketballPlayer("ok", null, 200),
      ];
      expect(pickBasketballBenchPlayer("PG", pool)?.id).toBe("ok");
      expect(pickBasketballBenchPlayer("PG", pool, ["ok"])).toBeUndefined();
    });

    it("returns undefined for an empty bench", () => {
      expect(pickBasketballBenchPlayer("PG", [])).toBeUndefined();
    });
  });

  describe("transitionPosition + applyLineup", () => {
    it("stamps lastBenchedAt when going on-court → bench", () => {
      const onCourt = mkBasketballPlayer("a", "PG");
      const next = transitionBasketballPosition(onCourt, null, 1_700_000_000_000);
      expect(next.position).toBeNull();
      expect(next.lastBenchedAt).toBe(1_700_000_000_000);
    });

    it("clears lastBenchedAt when coming back on", () => {
      const onBench: BasketballPlayer = { ...mkBasketballPlayer("a"), lastBenchedAt: 123 };
      const next = transitionBasketballPosition(onBench, "SG");
      expect(next.position).toBe("SG");
      expect(next.lastBenchedAt).toBeNull();
    });

    it("applyLineup moves named players on-court and benches the rest", () => {
      const players = [
        mkBasketballPlayer("a", "PG"),
        mkBasketballPlayer("b", "SG"),
        mkBasketballPlayer("c"),
      ];
      const lineup: BasketballQuarterLineup = {
        quarter: 2,
        assignments: { PG: "c", SG: "a" },
        createdAt: Date.now(),
      };
      const next = applyBasketballLineup(players, lineup);
      expect(next.find((p) => p.id === "c")?.position).toBe("PG");
      expect(next.find((p) => p.id === "a")?.position).toBe("SG");
      expect(next.find((p) => p.id === "b")?.position).toBeNull();
    });
  });

  describe("Rotation plan generators — honour periodType", () => {
    const makeRoster = (): BasketballPlayer[] => [
      mkBasketballPlayer("p1", "PG", 0, ["PG"]),
      mkBasketballPlayer("p2", "SG", 0, ["SG"]),
      mkBasketballPlayer("p3", "SF", 0, ["SF"]),
      mkBasketballPlayer("p4", "PF", 0, ["PF"]),
      mkBasketballPlayer("p5", "C", 0, ["C"]),
      mkBasketballPlayer("b1", null, 0, ["PG"]),
      mkBasketballPlayer("b2", null, 0, ["SG"]),
    ];

    it("time-based plan only schedules within visible periods (halves)", () => {
      const plan = generateBasketballTimeBasedRotationPlan(makeRoster(), 4, 10, "halves");
      const quarters = new Set(plan.map((s) => s.quarter));
      for (const q of quarters) {
        expect([1, 3]).toContain(q);
      }
    });

    it("time-based plan covers all 4 quarters by default", () => {
      const plan = generateBasketballTimeBasedRotationPlan(makeRoster(), 4, 10, "quarters");
      const quarters = new Set(plan.map((s) => s.quarter));
      expect(quarters.size).toBeGreaterThan(1);
      for (const q of quarters) expect([1, 2, 3, 4]).toContain(q);
    });

    it("quarter-break plan skips the first period (no break before tipoff)", () => {
      const plan = generateBasketballQuarterBreakRotationPlan(makeRoster(), 2, "quarters");
      expect(plan.every((s) => s.quarter !== 1)).toBe(true);
    });

    it("quarter-break plan in halves only plans for slot 3 (H2 break)", () => {
      const plan = generateBasketballQuarterBreakRotationPlan(makeRoster(), 2, "halves");
      for (const s of plan) expect(s.quarter).toBe(3);
    });
  });

  describe("getSubKey + getBench / getOnCourt", () => {
    it("getSubKey is stable across object identity", () => {
      const a = mkBasketballSub(1, 60, "x", "y", "PG");
      const b = mkBasketballSub(1, 60, "x", "y", "PG");
      expect(getBasketballSubKey(a)).toBe(getBasketballSubKey(b));
    });

    it("getBench / getOnCourt partition correctly", () => {
      const players = [mkBasketballPlayer("a", "PG"), mkBasketballPlayer("b"), mkBasketballPlayer("c", "C")];
      expect(getBasketballBench(players).map((p) => p.id)).toEqual(["b"]);
      expect(getBasketballOnCourt(players).map((p) => p.id).sort()).toEqual(["a", "c"]);
    });
  });
});
