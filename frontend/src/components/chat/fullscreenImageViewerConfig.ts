/**
 * Tunable gesture-arbitration constants for FullscreenImageViewer.
 *
 * These thresholds are intentionally exported (not inlined inside the
 * component effect) so:
 *
 *   1. Tests can import the same value the component uses, instead of
 *      hard-coding magic numbers that drift out of sync.
 *   2. We can tune them per device class in the future (e.g. raise
 *      TAP_MAX_HOLD_MS on slower Android devices where users press longer)
 *      by swapping this module's exports without touching the component.
 *
 * Units are milliseconds for time, CSS pixels for distance.
 */

/**
 * Maximum duration of a press that still counts as a "tap" candidate for
 * double-tap pairing. A press held longer than this is treated as a
 * long-press (iOS context menu, text-selection callout, Android haptic
 * preview) and MUST NOT trigger zoom.
 *
 * 500 ms matches the iOS Safari long-press threshold and the Android
 * default `ViewConfiguration.LONG_PRESS_TIMEOUT`. Lower values feel
 * snappier but risk classifying slow taps as long-presses; higher values
 * let context menus race the zoom toggle.
 */
export const TAP_MAX_HOLD_MS = 500;

/**
 * Maximum delay between two taps for them to pair into a double-tap.
 * 300 ms is the historical browser dblclick window and matches user
 * muscle memory for "double tap to zoom."
 */
export const DOUBLE_TAP_MS = 300;

/**
 * Maximum distance (in CSS pixels) between two consecutive taps for them
 * to pair into a double-tap. Anything further apart is treated as two
 * unrelated taps.
 */
export const DOUBLE_TAP_DIST = 32;

/**
 * Distance the finger must travel during a single touch sequence before
 * the gesture is reclassified from "tap" to "drag." Below this the user
 * is just holding a finger steady; above it they're panning.
 */
export const TAP_SLOP = 10;

/**
 * How long (ms) to suppress React's synthetic `onDoubleClick` after a
 * 3+ finger system gesture ends. Some browsers synthesize a `dblclick`
 * from multi-touch sequences; this window prevents those phantom events
 * from triggering zoom.
 */
export const MULTI_FINGER_SUPPRESS_MS = 350;
