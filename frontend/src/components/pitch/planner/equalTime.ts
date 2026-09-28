/**
 * Equal-time deterministic planner.
 *
 * Built to satisfy the spec:
 *  1. Target minutes computed up-front for every player.
 *  2. Globally optimises toward those targets (deficit-driven greedy).
 *  3. Minute deviation is the primary objective (continuity is broken if it
 *     reduces deviation).
 *  4. Bench time spreads evenly across the full game.
 *  5. Naturally converges to evenly-spaced rotations in 1-bench scenarios.
 *  6. GK halftime swap is honoured without dragging the rest of the squad
 *     off-target.
 *  7. Starter status is intentionally ignored — every player is treated as a
 *     pure rotation candidate.
 *
 * The algorithm walks the match in fine time-slices (default 30 s). At each
 * slice boundary it considers a single substitution that pulls the most
 * over-played player off and brings the most under-played player on, subject
 * to position eligibility and a configurable minimum shift length.
 *
 * The output is a SubstitutionEvent[] compatible with the existing planner
 * (same fields, same `time` / `half` semantics). The HT GK swap, when
 * present, is emitted as a sub event with `time: 0, half: 2` exactly as the
 * existing planner does — the rest of the system treats it identically.
 */

import type { PitchPosition } from "../PositionBadge";

export interface EqualTimePlayer {
  id: string;
  name: string;
  /** Currently on pitch in some position (any) — null = bench. */
  position: { x: number; y: number } | null;
  currentPitchPosition?: PitchPosition;
  /** Restricted set of allowed positions. Empty / undefined = anywhere. */
  assignedPositions?: PitchPosition[];
  /** Seconds already played before this plan starts. */
  minutesPlayed?: number;
  isInjured?: boolean;
}

export interface EqualTimeSubEvent {
  time: number;
  half: 1 | 2;
  playerOut: EqualTimePlayer;
  playerIn: EqualTimePlayer;
  positionSwap?: {
    player: EqualTimePlayer;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
}

export interface EqualTimePlanInput {
  players: EqualTimePlayer[];
  teamSize: number;
  halfDurationSec: number;
  /** First-half GK (locked into goal for half 1). */
  gk1H?: EqualTimePlayer;
  /** Second-half GK (locked into goal for half 2). May === gk1H (no swap). */
  gk2H?: EqualTimePlayer;
  /** Slice resolution. 30 s strikes a good balance of fairness vs tractability. */
  chunkSec?: number;
  /** Minimum on-pitch shift length before a player can be pulled (sec). */
  minShiftSec?: number;
  /** No subs in the first N seconds of each half. */
  noSubBeforeSec?: number;
  /** No subs in the trailing N seconds of each half. */
  noSubAfterSec?: number;
  /** Prefer the minimum-interruption cyclic solution when it is available. */
  preferCompactCycle?: boolean;
}

export interface EqualTimePlanResult {
  plan: EqualTimeSubEvent[];
  /** Projected total seconds per player at end of match. */
  projectedSec: Map<string, number>;
  /** Per-player target seconds (incl. GK time when applicable). */
  targetSec: Map<string, number>;
  /** max - min of deviation from target (seconds). */
  spreadSec: number;
  /** Largest single |actual - target| (seconds). */
  maxDeviationSec: number;
  /**
   * Mathematical fairness floor (the smallest spread possible, ignoring
   * cadence + position constraints). 0 when (slots × T) is divisible by N.
   */
  perfectFloorSec: number;
}

const DEFAULT_CHUNK = 30;

// True iff the player can stand in this position.
const canPlay = (p: EqualTimePlayer, pos: PitchPosition | undefined): boolean => {
  if (!pos) return true;
  if (!p.assignedPositions?.length) return true;
  return p.assignedPositions.includes(pos);
};

const isGkOnly = (p: EqualTimePlayer): boolean =>
  p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK";

export function buildEqualTimePlan(input: EqualTimePlanInput): EqualTimePlanResult {
  const {
    players,
    teamSize,
    halfDurationSec,
    gk1H,
    gk2H,
    chunkSec = DEFAULT_CHUNK,
    minShiftSec = 120,
    noSubBeforeSec = 0,
    noSubAfterSec = 30,
    preferCompactCycle = true,
  } = input;

  const totalSec = halfDurationSec * 2;
  const outfieldSlots = Math.max(0, teamSize - (gk1H ? 1 : 0));

  // A keeper who is replaced at halftime plays outfield in their other half,
  // so they belong in the rotation pool even when their assigned-position list
  // says "GK". A keeper who stays in goal for the whole match does NOT — they
  // are genuinely locked and must never be folded into an outfield equality
  // promise that cannot be kept.
  const gkRotates = !!(gk1H && gk2H && gk1H.id !== gk2H.id);
  const rotatingKeeperIds = new Set<string>();
  if (gkRotates) {
    rotatingKeeperIds.add(gk1H!.id);
    rotatingKeeperIds.add(gk2H!.id);
  }

  // Position eligibility. A rotating keeper whose only assigned position is GK
  // is treated as outfield-flexible for the half they are not in goal —
  // matching the main planner, which puts a rotating starting keeper back into
  // the outfield rotation regardless of their assigned-position list.
  const canPlayFor = (p: EqualTimePlayer, pos: PitchPosition | undefined) =>
    isGkOnly(p) && rotatingKeeperIds.has(p.id) ? true : canPlay(p, pos);

  const eligibleForHalf = (p: EqualTimePlayer, half: 1 | 2) => {
    if (half === 1) return !gk1H || p.id !== gk1H.id;
    return !gk2H || p.id !== gk2H.id;
  };

  const rotationPool = players.filter((p) => {
    if (p.isInjured) return false;
    if (isGkOnly(p) && !rotatingKeeperIds.has(p.id)) return false;
    // Must have at least one half where they can take an outfield slot.
    return eligibleForHalf(p, 1) || eligibleForHalf(p, 2);
  });
  const rotationIds = new Set(rotationPool.map((p) => p.id));
  if (rotationPool.length === 0 || outfieldSlots <= 0) {
    return {
      plan: [],
      projectedSec: new Map(),
      targetSec: new Map(),
      spreadSec: 0,
      maxDeviationSec: 0,
      perfectFloorSec: 0,
    };
  }

  // Per-half outfield-eligible pool. Excludes the half's GK (they're locked
  // into goal — they can't ALSO play outfield in that half).
  const eligibleH1 = new Set(
    rotationPool.filter((p) => eligibleForHalf(p, 1)).map((p) => p.id),
  );
  const eligibleH2 = new Set(
    rotationPool.filter((p) => eligibleForHalf(p, 2)).map((p) => p.id),
  );

  // ------------------------------------------------------------------
  // Targets.
  // ------------------------------------------------------------------
  // Outfield capacity per half is fixed: slots × half length. Goalkeeper
  // seconds are credited separately. The equal-time total is therefore the
  // outfield capacity available to the pool plus the goalkeeper seconds the
  // pool actually earns, divided across the pool.
  const gkSecondsFor = (id: string) => {
    let s = 0;
    if (gk1H && gk1H.id === id) s += halfDurationSec;
    if (gk2H && gk2H.id === id) s += halfDurationSec;
    return s;
  };
  const capacityPerHalf = outfieldSlots * halfDurationSec;
  const poolGkSeconds = rotationPool.reduce((s, p) => s + gkSecondsFor(p.id), 0);
  const alreadyPlayed = new Map<string, number>(
    rotationPool.map((p) => [p.id, Math.max(0, p.minutesPlayed ?? 0)] as const),
  );
  const totalAlready = rotationPool.reduce(
    (s, p) => s + (alreadyPlayed.get(p.id) ?? 0),
    0,
  );
  const perPlayerTarget =
    (capacityPerHalf * 2 + poolGkSeconds + totalAlready) / rotationPool.length;
  const targetSec = new Map<string, number>();
  rotationPool.forEach((p) => targetSec.set(p.id, perPlayerTarget));

  // Outfield seconds each player still needs to hit their equal-time total.
  const need = new Map<string, number>();
  rotationPool.forEach((p) => {
    need.set(
      p.id,
      Math.max(0, perPlayerTarget - gkSecondsFor(p.id) - (alreadyPlayed.get(p.id) ?? 0)),
    );
  });

  // Split each player's outfield need across the two halves, honouring the
  // per-half capacity and the fact that a keeper can only earn outfield
  // seconds in the half they are not in goal. This per-half allocation is the
  // core of the fix: the previous model only tracked whole-match deficits, so
  // a player whose outfield window closes at halftime was permanently
  // out-ranked by players who "still had the whole match to catch up" — and
  // then had no window left.
  const allocH1 = new Map<string, number>();
  const allocH2 = new Map<string, number>();
  {
    let rem1 = capacityPerHalf;
    let rem2 = capacityPerHalf;
    const flexible: string[] = [];
    rotationPool.forEach((p) => {
      const in1 = eligibleH1.has(p.id);
      const in2 = eligibleH2.has(p.id);
      const n = Math.min(need.get(p.id) ?? 0, in1 && in2 ? totalSec : halfDurationSec);
      if (in1 && !in2) {
        allocH1.set(p.id, n);
        allocH2.set(p.id, 0);
        rem1 -= n;
      } else if (!in1 && in2) {
        allocH1.set(p.id, 0);
        allocH2.set(p.id, n);
        rem2 -= n;
      } else if (in1 && in2) {
        flexible.push(p.id);
      } else {
        allocH1.set(p.id, 0);
        allocH2.set(p.id, 0);
      }
    });
    rem1 = Math.max(0, rem1);
    rem2 = Math.max(0, rem2);
    const flexTotal = flexible.reduce((s, id) => s + (need.get(id) ?? 0), 0);
    const remTotal = rem1 + rem2;
    flexible.forEach((id) => {
      const n = need.get(id) ?? 0;
      const share = flexTotal > 0 ? n / flexTotal : 0;
      // Distribute proportionally to the spare capacity in each half so the
      // per-half sums stay close to capacity.
      let v1 = remTotal > 0 ? Math.min(n, rem1 * share * (n > 0 ? 1 : 0)) : 0;
      v1 = Math.max(0, Math.min(v1, halfDurationSec));
      let v2 = Math.max(0, Math.min(n - v1, halfDurationSec));
      allocH1.set(id, v1);
      allocH2.set(id, v2);
    });
  }
  const allocFor = (id: string, half: 1 | 2) =>
    (half === 1 ? allocH1 : allocH2).get(id) ?? 0;


  // Initial outfield on-pitch. Players currently on the pitch in non-GK
  // positions form the starting outfield set. We honour up to `outfieldSlots`.
  const initialOutfieldOnPitch = players.filter(
    (p) => p.position !== null && p.currentPitchPosition !== "GK",
  );

  // Position bookkeeping: who currently stands where.
  const currentPosition = new Map<string, PitchPosition>();
  initialOutfieldOnPitch.forEach((p) => {
    const pos = (p.currentPitchPosition ??
      p.assignedPositions?.find((q) => q !== "GK") ??
      "MID") as PitchPosition;
    currentPosition.set(p.id, pos);
  });

  // Projected seconds — seeded from minutesPlayed (treated as seconds).
  const projected = new Map<string, number>();
  rotationPool.forEach((p) => projected.set(p.id, alreadyPlayed.get(p.id) ?? 0));
  // GK time is credited up-front (the GKs are guaranteed those seconds).
  if (gk1H) projected.set(gk1H.id, (projected.get(gk1H.id) ?? 0) + halfDurationSec);
  if (gk2H && (!gk1H || gk2H.id !== gk1H.id)) {
    projected.set(gk2H.id, (projected.get(gk2H.id) ?? 0) + halfDurationSec);
  }

  // playerById for quick lookups when constructing sub events.
  const playerById = new Map<string, EqualTimePlayer>(players.map((p) => [p.id, p]));

  const plan: EqualTimeSubEvent[] = [];
  const lastSubAt = new Map<string, number>(); // absolute seconds — last time involved in a swap
  const onPitchOutfield = new Set<string>(initialOutfieldOnPitch.map((p) => p.id));
  // Outfield seconds accumulated inside the current half.
  const accHalf = new Map<string, number>();

  // Exact compact solution for a clean, universally-compatible rotation.
  // Splitting the match into N equal periods and cycling one player through
  // the FIFO bench at each boundary gives every player exactly the same
  // number of periods, using N-1 substitutions instead of dozens of
  // 30-second greedy corrections. Do not use this shortcut when prior minutes
  // or a goalkeeper change require deficit-aware, per-half allocation.
  const occupiedPositions = [...new Set(currentPosition.values())];
  const cyclicBoundaries = Array.from(
    { length: Math.max(0, rotationPool.length - 1) },
    (_, index) => Math.round((totalSec * (index + 1)) / rotationPool.length),
  );
  const boundariesRespectBlackouts = cyclicBoundaries.every((absolute) => {
    const intoHalf = absolute < halfDurationSec ? absolute : absolute - halfDurationSec;
    return intoHalf >= noSubBeforeSec && intoHalf < halfDurationSec - noSubAfterSec;
  });
  const approximatePeriodSec = totalSec / rotationPool.length;
  const benchCount = rotationPool.length - outfieldSlots;
  const shortestRepeatGapSec = approximatePeriodSec * Math.min(outfieldSlots, benchCount);
  const universallyCompatible =
    !gkRotates &&
    preferCompactCycle &&
    totalAlready === 0 &&
    initialOutfieldOnPitch.length === outfieldSlots &&
    rotationPool.length > outfieldSlots &&
    boundariesRespectBlackouts &&
    shortestRepeatGapSec >= minShiftSec &&
    rotationPool.every((player) =>
      occupiedPositions.every((position) => canPlayFor(player, position)),
    );

  if (universallyCompatible) {
    const onQueue = initialOutfieldOnPitch.map((player) => player.id);
    const benchQueue = rotationPool
      .filter((player) => !onPitchOutfield.has(player.id))
      .map((player) => player.id);
    let previousAbs = 0;

    for (let period = 1; period < rotationPool.length; period += 1) {
      const absolute = cyclicBoundaries[period - 1];
      const elapsed = absolute - previousAbs;
      onQueue.forEach((id) => projected.set(id, (projected.get(id) ?? 0) + elapsed));

      const outId = onQueue.shift();
      const inId = benchQueue.shift();
      if (!outId || !inId) break;
      const outgoing = playerById.get(outId);
      const incoming = playerById.get(inId);
      const outPosition = currentPosition.get(outId);
      if (!outgoing || !incoming || !outPosition) break;

      plan.push({
        time: absolute < halfDurationSec ? absolute : absolute - halfDurationSec,
        half: absolute < halfDurationSec ? 1 : 2,
        playerOut: outgoing,
        playerIn: incoming,
        executed: false,
      });
      currentPosition.delete(outId);
      currentPosition.set(inId, outPosition);
      onPitchOutfield.delete(outId);
      onPitchOutfield.add(inId);
      onQueue.push(inId);
      benchQueue.push(outId);
      previousAbs = absolute;
    }

    const tail = totalSec - previousAbs;
    onQueue.forEach((id) => projected.set(id, (projected.get(id) ?? 0) + tail));
    const values = rotationPool.map((player) => projected.get(player.id) ?? 0);
    const deviations = rotationPool.map((player) =>
      Math.abs((projected.get(player.id) ?? 0) - (targetSec.get(player.id) ?? 0)),
    );
    return {
      plan,
      projectedSec: projected,
      targetSec,
      spreadSec: Math.max(...values) - Math.min(...values),
      maxDeviationSec: Math.max(...deviations),
      perfectFloorSec: 0,
    };
  }

  // Halftime re-allocation. The pre-match H2 allocation is a forecast; by the
  // break we know exactly what each player actually banked in H1, so we
  // re-solve H2 against real totals. Without this, first-half rounding and
  // cadence residue survive into the final numbers (each half could drift up
  // to one deadband, and the two errors compound).
  //
  // Solved by water-filling: alloc_i = clamp(perPlayerTarget + lambda - played_i,
  // 0, halfDurationSec) with lambda chosen so the allocations sum to the
  // half's outfield capacity. That levels final totals as far as the
  // per-player ceiling allows.
  const recomputeH2Alloc = () => {
    const ids = rotationPool.filter((p) => eligibleH2.has(p.id)).map((p) => p.id);
    rotationPool.forEach((p) => {
      if (!eligibleH2.has(p.id)) allocH2.set(p.id, 0);
    });
    if (ids.length === 0) return;
    const played = new Map(ids.map((id) => [id, projected.get(id) ?? 0] as const));
    const sumFor = (lambda: number) =>
      ids.reduce((s, id) => {
        const raw = perPlayerTarget + lambda - (played.get(id) ?? 0);
        return s + Math.max(0, Math.min(halfDurationSec, raw));
      }, 0);
    let lo = -totalSec - perPlayerTarget;
    let hi = totalSec + perPlayerTarget;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (sumFor(mid) < capacityPerHalf) lo = mid;
      else hi = mid;
    }
    const lambda = (lo + hi) / 2;
    ids.forEach((id) => {
      const raw = perPlayerTarget + lambda - (played.get(id) ?? 0);
      allocH2.set(id, Math.max(0, Math.min(halfDurationSec, raw)));
    });
  };


  // If there's an HT GK swap, emit it now (pure GK change — no outfield
  // positions involved). The downstream simulator treats this as such.
  if (gkRotates) {
    plan.push({
      time: 0,
      half: 2,
      playerOut: gk1H!,
      playerIn: gk2H!,
      executed: false,
    });
  }

  const cmpId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  const halfOf = (absT: number): 1 | 2 => (absT < halfDurationSec ? 1 : 2);
  const intoHalfSec = (absT: number, half: 1 | 2) =>
    half === 1 ? absT : absT - halfDurationSec;

  // Helper — pick the best single swap at `absT` in `half`, scored against the
  // per-half allocation. Returns null when no legal swap improves fairness.
  //
  // Score = sum of squared deviations from each player's allocation for THIS
  // half, projecting the candidate line-up forward to the end of the half.
  // Because the allocation already encodes goalkeeper windows and prior
  // minutes, a locally-greedy choice on this score converges on the globally
  // fair distribution instead of chasing whole-match deficits that some
  // players can no longer reach.
  const findBestSwap = (
    absT: number,
    half: 1 | 2,
  ): {
    out: EqualTimePlayer;
    in: EqualTimePlayer;
    outPos: PitchPosition;
    swap?: { player: EqualTimePlayer; fromPosition: PitchPosition; toPosition: PitchPosition };
    improvement: number;
  } | null => {
    const eligible = half === 1 ? eligibleH1 : eligibleH2;
    const remInHalf = halfDurationSec - intoHalfSec(absT, half);
    if (remInHalf <= 0) return null;

    const benchEligible: string[] = [];
    rotationPool.forEach((p) => {
      if (!eligible.has(p.id)) return;
      if (onPitchOutfield.has(p.id)) return;
      benchEligible.push(p.id);
    });
    const onPitchEligible = Array.from(onPitchOutfield).filter((id) =>
      rotationIds.has(id),
    );
    if (benchEligible.length === 0 || onPitchEligible.length === 0) return null;

    const scoreFor = (outId: string | null, inId: string | null) => {
      let sumSq = 0;
      let maxAbs = 0;
      rotationPool.forEach((p) => {
        if (!eligible.has(p.id)) return;
        const on =
          p.id === outId ? false : p.id === inId ? true : onPitchOutfield.has(p.id);
        const proj = (accHalf.get(p.id) ?? 0) + (on ? remInHalf : 0);
        const d = proj - allocFor(p.id, half);
        sumSq += d * d;
        const ad = Math.abs(d);
        if (ad > maxAbs) maxAbs = ad;
      });
      return { sumSq, maxAbs };
    };

    const base = scoreFor(null, null);
    // Deadband — once every eligible player is projected within half a minimum
    // shift of their allocation there is nothing worth substituting for. This
    // keeps the plan's substitution count in the same range as the
    // conventional planner instead of churning every slice.
    const deadband = chunkSec;
    if (base.maxAbs <= deadband) return null;

    let best:
      | {
          out: EqualTimePlayer;
          in: EqualTimePlayer;
          outPos: PitchPosition;
          swap?: {
            player: EqualTimePlayer;
            fromPosition: PitchPosition;
            toPosition: PitchPosition;
          };
          improvement: number;
          sumSq: number;
          maxAbs: number;
          outId: string;
          inId: string;
        }
      | null = null;

    for (const inId of benchEligible) {
      const inP = playerById.get(inId)!;
      const lastIn = lastSubAt.get(inId);
      if (lastIn !== undefined && absT - lastIn < minShiftSec + chunkSec) continue;
      for (const outId of onPitchEligible) {
        if (inId === outId) continue;
        const lastOut = lastSubAt.get(outId);
        if (lastOut !== undefined && absT - lastOut < minShiftSec) continue;

        const outP = playerById.get(outId)!;
        const outPos = currentPosition.get(outId);
        if (!outPos) continue;

        let swapMeta:
          | { player: EqualTimePlayer; fromPosition: PitchPosition; toPosition: PitchPosition }
          | undefined;

        if (!canPlayFor(inP, outPos)) {
          let foundSwap = false;
          for (const qId of onPitchEligible) {
            if (qId === outId || qId === inId) continue;
            const qPos = currentPosition.get(qId);
            const qP = playerById.get(qId);
            if (!qPos || !qP) continue;
            if (!canPlayFor(inP, qPos)) continue;
            if (!canPlayFor(qP, outPos)) continue;
            swapMeta = { player: qP, fromPosition: qPos, toPosition: outPos };
            foundSwap = true;
            break;
          }
          if (!foundSwap) continue;
        }

        const cand = scoreFor(outId, inId);
        if (cand.sumSq >= base.sumSq) continue;
        const improvement = base.sumSq - cand.sumSq;

        if (
          !best ||
          cand.sumSq < best.sumSq ||
          (cand.sumSq === best.sumSq && cand.maxAbs < best.maxAbs) ||
          (cand.sumSq === best.sumSq &&
            cand.maxAbs === best.maxAbs &&
            (cmpId(outId, best.outId) < 0 ||
              (outId === best.outId && cmpId(inId, best.inId) < 0)))
        ) {
          best = {
            out: outP,
            in: inP,
            outPos,
            swap: swapMeta,
            improvement,
            sumSq: cand.sumSq,
            maxAbs: cand.maxAbs,
            outId,
            inId,
          };
        }
      }
    }

    if (!best) return null;
    return {
      out: best.out,
      in: best.in,
      outPos: best.outPos,
      swap: best.swap,
      improvement: best.improvement,
    };
  };

  const applySwap = (
    time: number,
    half: 1 | 2,
    swap: NonNullable<ReturnType<typeof findBestSwap>>,
    absT: number,
  ) => {
    plan.push({
      time,
      half,
      playerOut: swap.out,
      playerIn: swap.in,
      executed: false,
      positionSwap: swap.swap,
    });
    onPitchOutfield.delete(swap.out.id);
    onPitchOutfield.add(swap.in.id);
    if (swap.swap) {
      currentPosition.set(swap.swap.player.id, swap.swap.toPosition);
      currentPosition.set(swap.in.id, swap.swap.fromPosition);
      currentPosition.delete(swap.out.id);
    } else {
      currentPosition.set(swap.in.id, swap.outPos);
      currentPosition.delete(swap.out.id);
    }
    lastSubAt.set(swap.out.id, absT);
    lastSubAt.set(swap.in.id, absT);
  };

  // ------------------------------------------------------------
  // Slice walk.
  // ------------------------------------------------------------
  let prevHalf: 1 | 2 = 1;
  const windowGapSec = Math.max(chunkSec, minShiftSec);
  const maxSwapsPerWindow = Math.max(1, Math.floor(outfieldSlots / 2));
  let lastWindowAt = Number.NEGATIVE_INFINITY;

  for (let absT = 0; absT < totalSec; absT += chunkSec) {
    const curHalf = halfOf(absT);

    // HT crossing.
    if (curHalf === 2 && prevHalf === 1) {
      accHalf.clear();
      recomputeH2Alloc();

      if (gkRotates) {
        // The incoming keeper cannot also hold an outfield slot in H2. If the
        // rotation left them on the pitch, hand their slot over explicitly so
        // the line-up never silently loses a position.
        if (onPitchOutfield.has(gk2H!.id)) {
          const vacatedPos = currentPosition.get(gk2H!.id);
          onPitchOutfield.delete(gk2H!.id);
          currentPosition.delete(gk2H!.id);
          const replacement =
            rotationPool
              .filter(
                (p) =>
                  eligibleH2.has(p.id) &&
                  !onPitchOutfield.has(p.id) &&
                  p.id !== gk2H!.id &&
                  canPlayFor(p, vacatedPos),
              )
              .sort(
                (a, b) =>
                  allocFor(b.id, 2) - allocFor(a.id, 2) || cmpId(a.id, b.id),
              )[0] ?? null;
          if (replacement && vacatedPos) {
            // The outgoing keeper leaves the pitch and a bench player takes the
            // slot the incoming keeper just vacated. We express this as
            // `gk1 off / replacement on` (rather than `gk2 off / ...`) because
            // the incoming keeper stays on the pitch — they only move into
            // goal — and every downstream simulator credits on-pitch time from
            // these events. Emitting `gk2 off` would silently strip the new
            // keeper of their entire second half.
            plan.push({
              time: 0,
              half: 2,
              playerOut: gk1H!,
              playerIn: replacement,
              executed: false,
            });
            onPitchOutfield.add(replacement.id);
            currentPosition.set(replacement.id, vacatedPos);
            lastSubAt.set(replacement.id, absT);
          }
        }
      }
      prevHalf = 2;
    }

    const intoHalf = intoHalfSec(absT, curHalf);
    const halfRemaining = halfDurationSec - intoHalf;
    const subEligible =
      intoHalf >= noSubBeforeSec &&
      halfRemaining > noSubAfterSec &&
      absT > 0 &&
      absT - lastWindowAt >= windowGapSec;

    if (subEligible) {
      // Substitutions are grouped into windows spaced at least one minimum
      // shift apart. Inside a window we keep taking the best legal swap while
      // it still improves fairness, which lands the line-up on its allocation
      // in a handful of windows rather than churning every slice.
      let applied = 0;
      for (let k = 0; k < maxSwapsPerWindow; k += 1) {
        const swap = findBestSwap(absT, curHalf);
        if (!swap) break;
        applySwap(intoHalf, curHalf, swap, absT);
        applied += 1;
      }
      if (applied > 0) lastWindowAt = absT;
    }

    // Credit this chunk to whoever is currently on the outfield.
    const credit = Math.min(chunkSec, totalSec - absT);
    onPitchOutfield.forEach((id) => {
      projected.set(id, (projected.get(id) ?? 0) + credit);
      accHalf.set(id, (accHalf.get(id) ?? 0) + credit);
    });
  }

  // Compute spread + max deviation across rotation pool.
  let minP = Infinity;
  let maxP = -Infinity;
  let maxDev = 0;
  rotationPool.forEach((p) => {
    const v = projected.get(p.id) ?? 0;
    if (v < minP) minP = v;
    if (v > maxP) maxP = v;
    const d = Math.abs(v - (targetSec.get(p.id) ?? 0));
    if (d > maxDev) maxDev = d;
  });

  // Mathematical floor: when (slots × T) is exactly divisible by N, perfect
  // equality is possible (spread = 0). Otherwise it's the residue from
  // integer-second rounding.
  const remainder = (perPlayerTarget * rotationPool.length) % rotationPool.length;
  const perfectFloorSec = remainder === 0 ? 0 : 1; // chunk-level resolution; near-zero

  return {
    plan,
    projectedSec: projected,
    targetSec,
    spreadSec: maxP - minP,
    maxDeviationSec: maxDev,
    perfectFloorSec,
  };
}

/**
 * Compute the mathematically-perfect target seconds per player given a
 * squad / slots / match length. Lives here so callers can show the floor in
 * fairness diagnostics without re-deriving it.
 */
export function equalTimeTargetSec(
  rotationPlayerCount: number,
  teamSize: number,
  totalMatchSec: number,
): number {
  if (rotationPlayerCount <= 0) return 0;
  return (teamSize * totalMatchSec) / rotationPlayerCount;
}
