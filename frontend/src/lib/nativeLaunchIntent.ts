/**
 * Native launch-intent readiness boundary.
 *
 * Cold-start race: `App.getLaunchUrl()` is async, but React + the Router mount
 * synchronously right after `initDeepLinkHandler()` is called. The protected
 * "/" route therefore redirects an unauthenticated user to generic `/auth`
 * before the emailed `/join/p/:token` launch URL is known — so the first tap on
 * an invite link showed the login screen instead of the invite journey.
 *
 * Requesting navigation is NOT proof the destination mounted: `navigate()` only
 * schedules a Router update. Releasing the boundary at request time let the
 * still-mounted protected route redirect to `/auth` and win the race. So the
 * boundary now has an explicit "awaiting navigation" phase and is only released
 * once the Router *commits* the retained destination.
 *
 *   pending                          – native launch intent not resolved yet
 *   failed-retrying                  – getLaunchUrl() rejected, bounded retry in flight
 *   resolved-none                    – ordinary launch, no URL
 *   resolved-url-awaiting-navigation – destination retained, Router not committed yet
 *   resolved-url-committed           – Router committed the launch destination
 *
 * Guarantees:
 * - Non-native platforms are `resolved-none` immediately (zero behaviour change).
 * - The wait is always bounded (`MAX_WAIT_MS`) so an ordinary launch can never
 *   hang on a spinner; a delayed acknowledgement triggers one navigation
 *   re-flush before the bounded fallback releases the gate.
 * - `appUrlOpen` arriving while pending settles the resolution step immediately.
 */
import { Capacitor } from "@capacitor/core";

export type LaunchIntentState =
  | "pending"
  | "failed-retrying"
  | "resolved-none"
  | "resolved-url-awaiting-navigation"
  | "resolved-url-committed";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 200;
/** Hard ceiling on how long routing may be held back. */
const MAX_WAIT_MS = 2500;
/** When acknowledgement is late, re-flush the retained navigation once. */
const REFLUSH_DELAY_MS = 600;

let state: LaunchIntentState = Capacitor.isNativePlatform()
  ? "pending"
  : "resolved-none";
let started = false;
let ceiling: ReturnType<typeof setTimeout> | null = null;
let reflushTimer: ReturnType<typeof setTimeout> | null = null;
/** True while we still expect the launch URL's navigation request. */
let capturingLaunchNavigation = false;
let retained: {
  destination: string;
  reflush?: () => void;
} | null = null;
const listeners = new Set<(s: LaunchIntentState) => void>();

export function getLaunchIntentState(): LaunchIntentState {
  return state;
}

/**
 * Routing must keep the neutral startup screen (and never redirect to /auth)
 * while this is true.
 */
export function isLaunchIntentPending(): boolean {
  return (
    state === "pending" ||
    state === "failed-retrying" ||
    state === "resolved-url-awaiting-navigation"
  );
}

/** The internal destination retained from the native launch URL, if any. */
export function getRetainedLaunchDestination(): string | null {
  return retained?.destination ?? null;
}

export function subscribeLaunchIntent(fn: (s: LaunchIntentState) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function clearTimers() {
  if (ceiling) clearTimeout(ceiling);
  ceiling = null;
  if (reflushTimer) clearTimeout(reflushTimer);
  reflushTimer = null;
}

function setState(next: LaunchIntentState) {
  if (state === next) return;
  // `resolved-none` and `resolved-url-committed` are terminal: startup is over,
  // so nothing may re-close the gate (warm deep links must not show a spinner).
  if (state === "resolved-none" || state === "resolved-url-committed") return;

  state = next;
  if (!isLaunchIntentPending()) clearTimers();
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (err) {
      console.error("[LaunchIntent] listener failed", err);
    }
  });
}

function armCeiling() {
  if (ceiling) clearTimeout(ceiling);
  ceiling = setTimeout(() => {
    if (!isLaunchIntentPending()) return;
    console.warn(
      "[LaunchIntent] Bounded wait elapsed — releasing startup boundary",
    );
    capturingLaunchNavigation = false;
    setState("resolved-none");
  }, MAX_WAIT_MS);
}

/**
 * Called when a launch URL is known (via `getLaunchUrl` or an immediate
 * `appUrlOpen`). Keeps the gate closed: we now await the Router commitment.
 */
export function markLaunchUrlReceived() {
  if (state === "resolved-url-committed" || state === "resolved-none") return;
  capturingLaunchNavigation = true;
  armCeiling();
  setState("resolved-url-awaiting-navigation");
}


/** Called when the launch-URL read completes with no URL. */
export function markLaunchIntentNone() {
  if (state === "resolved-url-awaiting-navigation" || state === "resolved-url-committed") return;
  capturingLaunchNavigation = false;
  setState("resolved-none");
}

/**
 * Reported by the app navigator for every non-React navigation request. While
 * the launch intent is awaiting navigation, the first request is retained as
 * the destination the Router must commit before the gate opens.
 */
export function noteLaunchNavigationRequested(
  destination: string,
  reflush?: () => void,
) {
  if (!capturingLaunchNavigation) return;
  capturingLaunchNavigation = false;
  retained = { destination, reflush };
  console.log("[LaunchIntent] Retained launch destination:", destination);
  armCeiling();
  setState("resolved-url-awaiting-navigation");

  if (reflushTimer) clearTimeout(reflushTimer);
  reflushTimer = setTimeout(() => {
    if (state !== "resolved-url-awaiting-navigation") return;
    console.warn("[LaunchIntent] Acknowledgement late — re-flushing retained navigation");
    try {
      retained?.reflush?.();
    } catch (err) {
      console.error("[LaunchIntent] Re-flush failed", err);
    }
  }, REFLUSH_DELAY_MS);
}

function normalize(path: string) {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 && withSlash.endsWith("/")
    ? withSlash.slice(0, -1)
    : withSlash;
}

/**
 * Acknowledgement from inside the Router: the given committed location is now
 * rendered. Releases the boundary once it matches the retained destination
 * (or any real destination other than the generic auth/root fallbacks).
 */
export function markLaunchNavigationCommitted(location: {
  pathname: string;
  search?: string;
  hash?: string;
}) {
  if (state !== "resolved-url-awaiting-navigation") return;
  const committed = normalize(
    `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`,
  );
  const target = retained ? normalize(retained.destination) : null;

  const committedPath = normalize(location.pathname);
  const matches = target
    ? committed === target ||
      committedPath === normalize(target.split(/[?#]/)[0]) ||
      (committedPath !== "/" && committedPath !== "/auth")
    : committedPath !== "/" && committedPath !== "/auth";

  if (!matches) return;
  console.log("[LaunchIntent] Launch destination committed:", committed);
  setState("resolved-url-committed");
}

/**
 * Resolve the native launch URL with bounded retries, handing any URL found to
 * `onUrl`. Safe to call once at startup; subsequent calls are no-ops.
 */
export function beginLaunchIntentResolution(
  readLaunchUrl: () => Promise<{ url?: string | null } | null | undefined>,
  onUrl: (url: string) => void,
) {
  if (started) return;
  started = true;

  if (!Capacitor.isNativePlatform()) {
    setState("resolved-none");
    return;
  }

  armCeiling();

  const attempt = (n: number) => {
    // A concurrent `appUrlOpen` may already have settled the resolution step.
    if (state === "resolved-url-committed") return;
    readLaunchUrl()
      .then((result) => {
        if (result?.url) {
          console.log("[LaunchIntent] Launch URL detected:", result.url);
          // Retain + queue the destination BEFORE anything is released, and
          // keep the gate closed until the Router commits it.
          markLaunchUrlReceived();
          onUrl(result.url);
        } else {
          markLaunchIntentNone();
        }
      })
      .catch((err) => {
        console.warn(`[LaunchIntent] getLaunchUrl attempt ${n} failed:`, err);
        if (n >= MAX_ATTEMPTS) {
          markLaunchIntentNone();
          return;
        }
        setState("failed-retrying");
        setTimeout(() => attempt(n + 1), RETRY_DELAY_MS);
      });
  };

  attempt(1);
}

/** Test helper. */
export function __resetLaunchIntentForTests() {
  clearTimers();
  started = false;
  capturingLaunchNavigation = false;
  retained = null;
  state = Capacitor.isNativePlatform() ? "pending" : "resolved-none";
  listeners.clear();
}
