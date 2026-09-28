/**
 * Batch 3D: tunables for the jump-to-message settle window.
 *
 * With Batch 3C deferring link-preview fetches during a jump, row heights
 * stay stable through the landing window — so the long 6.5s multi-pass
 * settle is no longer earning its keep. These knobs shrink the window
 * (overlay disappears sooner, perceived load drops by ~3-4s) while keeping
 * an early-pass safety net for any non-preview late hydration.
 *
 * Kill-switches (no redeploy):
 *   - localStorage.setItem('ignite_disable_short_jump_settle', '1')
 *       → reverts to legacy 6.5s tail + 6-pass settle
 *   - window.__disableShortJumpSettle = true (runtime override)
 */

declare global {
  interface Window {
    __disableShortJumpSettle?: boolean;
  }
}

export interface JumpSettleConfig {
  settlePasses: number[];
  tailReleaseMs: number;
}

const LEGACY: JumpSettleConfig = {
  settlePasses: [250, 600, 1100, 1800, 3000, 4500],
  tailReleaseMs: 6500,
};

// Batch 3D: tighter window. Three passes cover (a) initial frame, (b)
// post-image-decode, (c) post-async-row-content. Tail at 2200ms releases
// the overlay and jump-active flag right after the last pass.
const SHORT: JumpSettleConfig = {
  settlePasses: [200, 600, 1400],
  tailReleaseMs: 2200,
};

function isShortDisabled(): boolean {
  try {
    if (typeof window !== "undefined" && window.__disableShortJumpSettle) return true;
    if (typeof localStorage !== "undefined" &&
        localStorage.getItem("ignite_disable_short_jump_settle") === "1") {
      return true;
    }
  } catch { /* noop */ }
  return false;
}

export function getJumpSettleConfig(): JumpSettleConfig {
  return isShortDisabled() ? LEGACY : SHORT;
}
