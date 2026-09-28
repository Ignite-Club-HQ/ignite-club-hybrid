/**
 * Router navigation bridge for code that lives outside React (deep link
 * handler, push handlers).
 *
 * Deep links used to do `window.location.href = path`, which triggers a full
 * webview reload on Android resume and wipes in-memory state (including an
 * in-progress invite/signup hand-off). Registering the router's `navigate`
 * here lets non-React code do a soft SPA navigation instead, with a hard
 * navigation kept only as a last-resort fallback.
 *
 * Cold start ordering: a deep link that launches the app is processed before
 * React mounts, so no navigator exists yet. Instead of hard-navigating (which
 * on native reloads the bundle back to "/" and lands unauthenticated users on
 * /auth, losing the invite), we queue the destination and flush it the moment
 * the router registers.
 *
 * Every request is also reported to the native launch-intent boundary so a
 * cold-start launch destination is *retained* until the Router commits it —
 * requesting navigation is not proof it mounted.
 */
import { noteLaunchNavigationRequested } from "@/lib/nativeLaunchIntent";

type Navigator = (path: string, opts?: { replace?: boolean }) => void;

let appNavigator: Navigator | null = null;
let pending: { path: string; opts?: { replace?: boolean } } | null = null;

export function setAppNavigator(nav: Navigator | null) {
  appNavigator = nav;
  if (nav && pending) {
    const queued = pending;
    pending = null;
    try {
      nav(queued.path, queued.opts);
    } catch (err) {
      console.error("[Navigator] Flushing queued navigation failed", err);
    }
  }
}

export function navigateApp(path: string, opts?: { replace?: boolean }) {
  // Retain this destination if it is the cold-start launch navigation; the
  // startup gate stays closed until the Router commits it.
  noteLaunchNavigationRequested(path, () => {
    if (appNavigator) {
      try {
        appNavigator(path, opts);
        return;
      } catch (err) {
        console.error("[Navigator] Re-flush failed", err);
      }
    }
    pending = { path, opts };
  });

  if (appNavigator) {
    try {
      appNavigator(path, opts);
      return;
    } catch (err) {
      console.error("[Navigator] Soft navigation failed, falling back", err);
    }
  }
  // Router not mounted yet — remember where we were headed.
  pending = { path, opts };
  console.log("[Navigator] Queued navigation until router mounts:", path);
}

/** Test/diagnostic helper. */
export function getPendingNavigation() {
  return pending;
}
