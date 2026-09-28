/**
 * Lightweight, contextual onboarding for the long-press message interaction.
 *
 * Surface (single, minimal):
 *   - A small auto-fading caption appears once below the very first message
 *     bubble the user sees, then never again on that device.
 *
 * State persisted in localStorage. Intentionally NOT using the `ignite_`
 * prefix so the flag survives sign-out / user-switch sweeps in
 * `clearUserScopedCaches` — once shown (or once the user has long-pressed
 * a message), it should stay dismissed forever on that device.
 */

const STORAGE_KEY = "chat_actions_onboarding_v1";
const LEGACY_STORAGE_KEY = "ignite_chat_actions_onboarding_v1";

interface OnboardingState {
  completed: boolean;
  firstHintShown: boolean;
}

function readState(): OnboardingState {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { completed: false, firstHintShown: false };
    const parsed = JSON.parse(raw);
    return {
      completed: !!parsed.completed,
      // Treat any prior dismissal/completion as "already shown" so the
      // hint doesn't re-appear for upgrading users.
      firstHintShown: !!parsed.firstHintShown || !!parsed.dismissed || !!parsed.completed,
    };
  } catch {
    return { completed: false, firstHintShown: false };
  }
}

function writeState(next: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch {}
  } catch {}
}

// In-memory claim so only one mounted message row in a session shows the
// hint, even if many rows mount in the same tick before localStorage is
// re-read.
let claimedThisSession = false;

/** Marks the user as educated. Suppresses any future first-bubble hint. */
export function markLongPressOnboardingCompleted() {
  claimedThisSession = true;
  const s = readState();
  if (s.completed && s.firstHintShown) return;
  writeState({ completed: true, firstHintShown: true });
}

/**
 * Claim the one-and-only first-bubble hint slot. Returns true exactly once
 * per device; subsequent calls (and other mounted rows in the same session)
 * always return false.
 */
export function claimFirstBubbleHint(): boolean {
  if (claimedThisSession) return false;
  const s = readState();
  if (s.completed || s.firstHintShown) {
    claimedThisSession = true;
    return false;
  }
  claimedThisSession = true;
  writeState({ ...s, firstHintShown: true });
  return true;
}
