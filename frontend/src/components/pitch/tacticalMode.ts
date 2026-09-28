import { PitchPosition } from "./PositionBadge";
import { TeamSize, Player } from "./types";

/**
 * Recommended formation indices per team size for each tactical mode.
 * Maps to the FORMATIONS array index. Neutral = no recommendation (keep current).
 * Based on: attack = more forwards, defend = more defenders.
 */
export const RECOMMENDED_FORMATIONS: Record<TeamSize, { attack: number; defend: number }> = {
  "3":  { attack: 2, defend: 1 },   // Attack: 1-2 (2 fwd), Defend: 2-1 (2 def)
  "4":  { attack: 2, defend: 1 },   // Attack: 1-1-2, Defend: 2-1-1
  "5":  { attack: 1, defend: 3 },   // Attack: 2-1-2, Defend: 2-2-1
  "6":  { attack: 2, defend: 0 },   // Attack: 2-1-2, Defend: 2-2-1
  "7":  { attack: 2, defend: 1 },   // Attack: 2-2-2, Defend: 3-2-1
  "8":  { attack: 1, defend: 2 },   // Attack: 2-3-2, Defend: 3-2-2
  "9":  { attack: 1, defend: 0 },   // Attack: 3-2-3, Defend: 3-3-2
  "10": { attack: 2, defend: 1 },   // Attack: 3-3-3, Defend: 4-3-2
  "11": { attack: 1, defend: 2 },   // Attack: 4-3-3, Defend: 3-5-2
};

export type TacticalMode = "neutral" | "attack" | "defend";

interface TacticalOffset {
  dx: number; // percentage-point shift in X
  dy: number; // percentage-point shift in Y
  isAnchor?: boolean;
}

/**
 * Batch-calculate tactical OFFSETS (not absolute positions) for all on-pitch players.
 * Returns a Map of playerId → { dx, dy } pixel-percentage offsets to apply via CSS translate.
 * The stored player.position is never modified — offsets are purely visual.
 */
export const computeTacticalOffsets = (
  players: Player[],
  mode: TacticalMode,
  teamSize: TeamSize,
  isMiniLeague: boolean = false,
): Map<string, TacticalOffset> => {
  const result = new Map<string, TacticalOffset>();
  const onPitch = players.filter(p => p.position !== null);

  if (mode === "neutral") {
    return result; // empty map = no offsets
  }

  const isSmallSided = parseInt(teamSize) <= 7;
  const isWide = (x: number) => x < 42 || x > 58;
  const isLeft = (x: number) => x < 50;

  // Classify lines for special roles
  const midfielders = onPitch.filter(p => p.currentPitchPosition === "MID");
  const defenders = onPitch.filter(p => p.currentPitchPosition === "DEF");

  // ATTACK with 5+ mids: detect flat vs split midfield
  const holdingMidIds = new Set<string>();
  let isAttackFlatMidfield5 = false;
  if (mode === "attack" && midfielders.length >= 5) {
    const midYs = midfielders.map(m => m.position!.y);
    const minY = Math.min(...midYs);
    const maxY = Math.max(...midYs);
    isAttackFlatMidfield5 = (maxY - minY) < 12;

    if (!isAttackFlatMidfield5) {
      const sortedByDepth = [...midfielders].sort((a, b) => b.position!.y - a.position!.y);
      holdingMidIds.add(sortedByDepth[0].id);
      holdingMidIds.add(sortedByDepth[1].id);
    }
  }

  // DEFEND: pick one central midfielder as anchor only for narrow midfield shapes
  let anchorMidId: string | null = null;
  if (mode === "defend" && midfielders.length > 0 && midfielders.length <= 3) {
    const centralMids = midfielders.filter(m => !isWide(m.position!.x));
    const sorted = (centralMids.length > 0 ? centralMids : midfielders).sort((a, b) =>
      Math.abs(a.position!.x - 50) - Math.abs(b.position!.x - 50)
    );
    anchorMidId = sorted[0].id;
  }

  // DEFEND with 5+ mids: detect if it's a split (4-2-3-1) or flat (3-5-2) midfield
  let defendCentralPlaymakerId: string | null = null;
  let isFlatMidfield5 = false;
  if (mode === "defend" && midfielders.length >= 5) {
    // Check if mids are on roughly the same Y line (flat) vs split lines
    const midYs = midfielders.map(m => m.position!.y);
    const minY = Math.min(...midYs);
    const maxY = Math.max(...midYs);
    isFlatMidfield5 = (maxY - minY) < 12; // within 12% = same line

    if (!isFlatMidfield5) {
      // Split midfield (e.g. 4-2-3-1): identify central attacking mid (#10)
      const topLineCount = Math.max(1, midfielders.length - 2);
      const highestMids = [...midfielders]
        .sort((a, b) => a.position!.y - b.position!.y)
        .slice(0, topLineCount);
      const sortedByCenter = highestMids.sort((a, b) =>
        Math.abs(a.position!.x - 50) - Math.abs(b.position!.x - 50)
      );
      defendCentralPlaymakerId = sortedByCenter[0]?.id ?? null;
    }
  }

  const defendCentralForwardX = (() => {
    if (mode !== "defend") return null;
    const forwards = onPitch.filter(p => p.currentPitchPosition === "FWD" && p.position);
    if (forwards.length === 0) return null;
    const mostCentralForward = [...forwards].sort((a, b) =>
      Math.abs(a.position!.x - 50) - Math.abs(b.position!.x - 50)
    )[0];
    return mostCentralForward.position!.x;
  })();

  const centralDefendersInBackFour = defenders.length >= 4
    ? [...defenders]
        .sort((a, b) => Math.abs(a.position!.x - 50) - Math.abs(b.position!.x - 50))
        .slice(0, 2)
        .sort((a, b) => a.position!.x - b.position!.x)
    : [];
  const leftCentralDefenderId = centralDefendersInBackFour[0]?.id ?? null;
  const rightCentralDefenderId = centralDefendersInBackFour[1]?.id ?? null;

  // In defend mode, keep a clear visual channel between defenders and goalkeeper.
  const projectedGoalkeeperY = (() => {
    if (mode !== "defend") return null;
    const gk = onPitch.find(player => player.currentPitchPosition === "GK" && player.position);
    if (!gk) return null;

    let gkY = gk.position!.y; // match defend-mode GK offset
    if (gkY < 20) gkY = 20;
    if (gkY > 84) gkY = 84;
    return gkY;
  })();
  const MIN_DEFENDER_GK_GAP = isSmallSided ? 8 : 10;

  // In attack mode, keep midfield clearly separated from the forward line.
  const projectedDeepestForwardY = (() => {
    if (mode !== "attack") return null;
    const forwards = onPitch.filter(player => player.currentPitchPosition === "FWD" && player.position);
    if (forwards.length === 0) return null;

    const forwardDy = isSmallSided ? -6 : -8;
    return forwards.reduce((deepestY, forward) => {
      let projectedY = forward.position!.y + forwardDy;
      if (projectedY < 20) projectedY = 20;
      if (projectedY > 84) projectedY = 84;
      return Math.max(deepestY, projectedY);
    }, 20);
  })();
  const MIN_MID_FORWARD_GAP = isSmallSided ? 20 : 18;

  for (const p of onPitch) {
    const bx = p.position!.x;
    const pos = p.currentPitchPosition;
    let dx = 0;
    let dy = 0;
    let isAnchor = false;

    if (mode === "attack") {
      switch (pos) {
        case "GK":
          dy = -4; // sweeper-keeper: step off line
          break;
        case "DEF":
          // Back line steps up to compress space; wide defenders spread
          dy = isSmallSided ? -6 : -8;
          if (isWide(bx)) dx = isLeft(bx) ? -8 : 8; // spread wide
          break;
        case "MID":
          if (isAttackFlatMidfield5 && midfielders.length >= 5) {
            // Flat midfield 5 (e.g. 3-5-2): push all up evenly, spread across lanes
            dy = isSmallSided ? -12 : -16;
            const sortedByX = [...midfielders].sort((a, b) => a.position!.x - b.position!.x);
            const myIndex = sortedByX.findIndex(m => m.id === p.id);
            const lanes = [10, 28, 50, 72, 90];
            dx = lanes[myIndex] - bx;
          } else if (holdingMidIds.has(p.id)) {
            // Holding mids: stay deeper, only slight push forward
            dy = isSmallSided ? -4 : -6;
            if (isWide(bx)) dx = isLeft(bx) ? -6 : 6;
            else dx = bx <= 50 ? -6 : 6;
          } else {
            // Attacking mids: push much higher toward forwards
            dy = isSmallSided ? -16 : -20;
            if (isWide(bx)) {
              dx = isLeft(bx) ? -10 : 10;
            } else if (holdingMidIds.size > 0) {
              // 5+ mid shape (e.g. 4-2-3-1): most central attacking mid stays as #10
              const attackingMids = midfielders.filter(m => !holdingMidIds.has(m.id));
              const sortedByCenter = [...attackingMids].sort((a, b) =>
                Math.abs(a.position!.x - 50) - Math.abs(b.position!.x - 50)
              );
              if (sortedByCenter[0]?.id === p.id) {
                dx = 0;
              } else {
                dx = bx <= 50 ? -8 : 8;
              }
            } else if (midfielders.length >= 4) {
              dx = bx <= 50 ? -8 : 8;
            }
          }
          break;
        case "FWD": {
          // Forwards push highest — clear visible jump
          dy = isSmallSided ? -18 : -22;
          const forwards = onPitch.filter(pl => pl.currentPitchPosition === "FWD");
          const fwdSpread = forwards.length <= 2 ? 6 : 12;
          if (isWide(bx)) dx = isLeft(bx) ? -fwdSpread : fwdSpread;
        }
          break;
      }
    } else if (mode === "defend") {
      switch (pos) {
        case "GK":
          dy = 0; // GK already deep; clamping would pull them forward
          break;
        case "DEF":
          // Defenders drop clearly deeper and tuck in compact
          dy = isSmallSided ? 26 : 28;
          if (p.id === leftCentralDefenderId) {
            dx = (50 - 7) - bx; // fixed central-left lane in back-four
          } else if (p.id === rightCentralDefenderId) {
            dx = (50 + 7) - bx; // fixed central-right lane in back-four
          } else if (isWide(bx)) {
            dx = isLeft(bx) ? 6 : -6; // tuck narrow
          } else if (bx < 50) {
            dx = -6;
          } else if (bx > 50) {
            dx = 6;
          }
          break;
        case "MID":
          // Midfield drops to protect space in front of defenders
          dy = isSmallSided ? 6 : 8;
          if (p.id === anchorMidId) {
            // Anchor stays central-ish for narrow midfield shapes
            if (bx < 45) dx = 6;
            else if (bx > 55) dx = -6;
            isAnchor = true;
          } else if (isFlatMidfield5 && midfielders.length >= 5) {
            // Flat midfield 5 (e.g. 3-5-2): spread evenly across fixed lanes
            const sortedByX = [...midfielders].sort((a, b) => a.position!.x - b.position!.x);
            const myIndex = sortedByX.findIndex(m => m.id === p.id);
            const lanes = [15, 30, 50, 70, 85];
            dx = lanes[myIndex] - bx;
          } else if (midfielders.length >= 4) {
            // Split midfield (e.g. 4-2-3-1) or 4-mid shapes
            if (p.id === defendCentralPlaymakerId) {
              const targetX = defendCentralForwardX ?? 50;
              dx = targetX - bx;
            } else if (isWide(bx)) dx = isLeft(bx) ? 3 : -3;
            else dx = bx <= 50 ? -4 : 4;
          } else {
            // Smaller midfield shapes: wide mids tuck in
            if (isWide(bx)) dx = isLeft(bx) ? 8 : -8;
            else if (bx < 50) dx = -6;
            else if (bx > 50) dx = 6;
          }
          break;
        case "FWD":
          // Forwards drop slightly but remain as outlet
          dy = isSmallSided ? 4 : 6;
          if (isWide(bx)) dx = isLeft(bx) ? 6 : -6; // tuck in
          break;
      }
    }

    // Scale offsets for mini-league half-pitch mode
    if (isMiniLeague && (dx !== 0 || dy !== 0)) {
      const HALF_SCALE = 0.45;
      dy *= HALF_SCALE;
      // Team B is vertically mirrored: "deeper" = lower y, so invert dy
      if (p.teamSide === "b") dy = -dy;
    }

    if (dx !== 0 || dy !== 0) {
      const baseY = p.position!.y;

      // Determine Y bounds based on mini-league team side
      let minY = 20, maxY = 84;
      if (isMiniLeague) {
        if (p.teamSide === "a") {
          minY = 52; maxY = 93;
        } else if (p.teamSide === "b") {
          minY = 7; maxY = 48;
        }
      }

      // Clamp so players stay within their pitch area
      const finalY = baseY + dy;
      if (finalY < minY) dy = minY - baseY;
      if (finalY > maxY) dy = maxY - baseY;

      if (mode === "defend" && pos === "DEF" && projectedGoalkeeperY !== null && !isMiniLeague) {
        const maxDefenderY = projectedGoalkeeperY - MIN_DEFENDER_GK_GAP;
        const adjustedY = baseY + dy;
        if (adjustedY > maxDefenderY) {
          dy = maxDefenderY - baseY;
        }
      }

      if (mode === "attack" && pos === "MID" && projectedDeepestForwardY !== null && !isMiniLeague) {
        const minMidY = Math.min(projectedDeepestForwardY + MIN_MID_FORWARD_GAP, 84);
        const adjustedY = baseY + dy;
        if (adjustedY < minMidY) {
          dy = minMidY - baseY;
        }
      }

      // Clamp horizontal to stay within pitch (2%-98%)
      const finalX = bx + dx;
      if (finalX < 2) dx = 2 - bx;
      if (finalX > 98) dx = 98 - bx;
      result.set(p.id, { dx, dy, isAnchor });
    }
  }

  return result;
};

/**
 * Compute a visual offset for the soccer ball so it doesn't overlap with
 * any player's effective (offset-adjusted) position while staying near centre.
 */
export const computeBallOffset = (
  ballPosition: { x: number; y: number },
  players: Player[],
  tacticalOffsets: Map<string, TacticalOffset>,
  mode: TacticalMode,
): { dx: number; dy: number } => {
  if (mode === "neutral") return { dx: 0, dy: 0 };

  // Start at center dot (no mode-based nudge)
  let dy = 0;
  let dx = 0;

  const bx = ballPosition.x + dx;
  const by = ballPosition.y + dy;

  // Gather effective player positions (base + offset)
  const effectivePositions = players
    .filter(p => p.position !== null)
    .map(p => {
      const off = tacticalOffsets.get(p.id);
      return {
        x: p.position!.x + (off?.dx ?? 0),
        y: p.position!.y + (off?.dy ?? 0),
      };
    });

  // If any player is too close, nudge the ball away
  const MIN_DIST = 6; // percentage points
  for (let attempt = 0; attempt < 5; attempt++) {
    const curX = ballPosition.x + dx;
    const curY = ballPosition.y + dy;
    let tooClose = false;

    for (const ep of effectivePositions) {
      const dist = Math.sqrt((curX - ep.x) ** 2 + (curY - ep.y) ** 2);
      if (dist < MIN_DIST) {
        // Push ball away from the player
        const angle = Math.atan2(curY - ep.y, curX - ep.x);
        dx += Math.cos(angle) * 2;
        dy += Math.sin(angle) * 2;
        tooClose = true;
      }
    }
    if (!tooClose) break;
  }

  // Clamp to keep ball near centre circle area (x: 30-70, y: 35-65)
  const finalX = ballPosition.x + dx;
  const finalY = ballPosition.y + dy;
  if (finalX < 30) dx = 30 - ballPosition.x;
  if (finalX > 70) dx = 70 - ballPosition.x;
  if (finalY < 35) dy = 35 - ballPosition.y;
  if (finalY > 65) dy = 65 - ballPosition.y;

  return { dx, dy };
};

/** Toast messages for mode changes */
export const TACTICAL_MODE_MESSAGES: Record<TacticalMode, string> = {
  attack: "Attack mode enabled",
  defend: "Defensive shape enabled",
  neutral: "Balanced shape restored",
};

/** Labels for the timer subtitle */
export const TACTICAL_MODE_LABELS: Record<TacticalMode, string> = {
  attack: "Attack",
  defend: "Defend",
  neutral: "Neutral",
};
