import { isPlanPlayableFromPlayers } from "./validation";

interface ExistingPlanPlayer {
  id: string;
  position: { x: number; y: number } | null;
}

interface ExistingPlanSubstitution<P extends ExistingPlanPlayer> {
  half: 1 | 2;
  time: number;
  playerOut: P;
  playerIn: P;
  executed?: boolean;
  skipped?: boolean;
}

export interface ExistingPlanResolution<S> {
  plan?: S[];
  hasRemainingPlan: boolean;
  isPlayable: boolean;
  reason: "none" | "completed" | "edit-repair" | "playable" | "stale";
}

/** Edit mode retains stale future work for repair; forecast mode regenerates it. */
export function resolveExistingPlan<
  P extends ExistingPlanPlayer,
  S extends ExistingPlanSubstitution<P>,
>({
  players,
  existingPlan,
  editMode,
  halfDurationSeconds,
}: {
  players: P[];
  existingPlan?: S[];
  editMode: boolean;
  halfDurationSeconds: number;
}): ExistingPlanResolution<S> {
  if (!existingPlan) {
    return { plan: undefined, hasRemainingPlan: false, isPlayable: false, reason: "none" };
  }
  const hasRemainingPlan = existingPlan.some(
    (substitution) => !substitution.executed && !substitution.skipped,
  );
  if (!hasRemainingPlan) {
    return { plan: undefined, hasRemainingPlan: false, isPlayable: false, reason: "completed" };
  }

  const isPlayable = isPlanPlayableFromPlayers(players, existingPlan, halfDurationSeconds);
  if (editMode) {
    return {
      plan: existingPlan,
      hasRemainingPlan: true,
      isPlayable,
      reason: isPlayable ? "playable" : "edit-repair",
    };
  }
  return isPlayable
    ? { plan: existingPlan, hasRemainingPlan: true, isPlayable: true, reason: "playable" }
    : { plan: undefined, hasRemainingPlan: true, isPlayable: false, reason: "stale" };
}
