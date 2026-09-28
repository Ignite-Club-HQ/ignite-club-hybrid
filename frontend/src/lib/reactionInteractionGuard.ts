const DEFAULT_REACTION_GUARD_MS = 900;

let reactionInteractionGuardUntil = 0;

const getNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function armReactionInteractionGuard(ms = DEFAULT_REACTION_GUARD_MS) {
  reactionInteractionGuardUntil = Math.max(reactionInteractionGuardUntil, getNow() + ms);
}

export function isReactionInteractionGuardActive() {
  return getNow() < reactionInteractionGuardUntil;
}

export function preventIfReactionInteractionGuarded(event?: {
  preventDefault?: () => void;
  stopPropagation?: () => void;
}) {
  if (!isReactionInteractionGuardActive()) return false;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  return true;
}