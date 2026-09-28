/**
 * Handler for notification taps that launch the app from cold start.
 *
 * This is the SINGLE source of truth for `pushNotificationActionPerformed`
 * on native. It must be initialized early in the app lifecycle (in main.tsx)
 * to catch taps that fire before React mounts.
 *
 * Architecture (BUG-1 fix — was triple-registered):
 *   - Exactly one Capacitor `pushNotificationActionPerformed` listener,
 *     installed here at module load.
 *   - React side registers a `navigator` via `setNotificationNavigator()` so
 *     warm taps navigate immediately. If no navigator is registered (cold
 *     start), the URL is stashed and consumed by `processPendingNotificationNavigation`.
 *   - Cross-cutting concerns (pitch board open, active-club switch) are
 *     broadcast via the `ignite:notification-tapped` CustomEvent so multiple
 *     consumers can react without re-registering plugin listeners.
 */

import { PushNotifications } from '@capacitor/push-notifications';
import { preloadMessageFromNotification } from './notificationPreload';
import { captureJumpFromNotification, normalizeNotificationChatUrl, getJumpTarget } from './pendingChatJump';
import { suppressChatScope, type SuppressedChatKind } from './pushTapSuppression';
import { prefetchChatChunkForUrl } from './chatChunkPrefetch';
import { requestClubSwitchForNotification } from './notificationClubSwitch';
import { mark as coldMark, remark as coldRemark, startLongTaskWindow } from './coldStartMarks';

// Store pending navigation URL until the app is ready to handle it
let pendingNavigationUrl: string | null = null;
let navigationHandled = false;

const PENDING_NAV_KEY = 'pendingPushNavigationUrl';
const PENDING_NAV_AT_KEY = 'pendingPushNavigationAt';
/**
 * A stashed push route is only ever meant to serve the launch it came from.
 * Without a TTL a stash that never drained (router race, sign-out mid-flight)
 * survived in sessionStorage and later hijacked an unrelated launch — e.g. an
 * emailed `/join/p/:token` invite got pushed aside by an old `/teams/:id`.
 */
const PENDING_NAV_TTL_MS = 120_000;

/** Invite/auth deep-link routes that must never be navigated away from. */
const INVITE_PATH_RE = /^\/(join|join-club|i|claim-team)(\/|$)/;

// Registered navigator from React side (warm-tap path)
type Navigator = (path: string) => void;
let activeNavigator: Navigator | null = null;

export function setNotificationNavigator(nav: Navigator) {
  activeNavigator = nav;
}

export function clearNotificationNavigator(nav: Navigator) {
  if (activeNavigator === nav) activeNavigator = null;
}

function persistPendingNav(url: string) {
  try {
    sessionStorage.setItem(PENDING_NAV_KEY, url);
    sessionStorage.setItem(PENDING_NAV_AT_KEY, String(Date.now()));
  } catch {}
}

function readPersistedPendingNav(): string | null {
  try {
    const url = sessionStorage.getItem(PENDING_NAV_KEY);
    if (!url) return null;
    const at = Number(sessionStorage.getItem(PENDING_NAV_AT_KEY) || 0);
    if (!at || Date.now() - at > PENDING_NAV_TTL_MS) {
      clearPersistedPendingNav();
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function clearPersistedPendingNav() {
  try {
    sessionStorage.removeItem(PENDING_NAV_KEY);
    sessionStorage.removeItem(PENDING_NAV_AT_KEY);
  } catch {}
}

/**
 * A deep link (emailed invite link, universal link) is an explicit, current
 * user intent and always outranks a stashed push route. Called by the deep
 * link handler so the stash cannot land on top of the invite screen.
 */
export function abandonPendingNotificationNavigation(reason: string) {
  if (pendingNavigationUrl || readPersistedPendingNav()) {
    console.log('[NotificationLaunch] Abandoning pending push nav:', reason);
  }
  pendingNavigationUrl = null;
  clearPersistedPendingNav();
  navigationHandled = true;
}


// Global flag for pending force-update prompt (survives timing races)
let pendingForceUpdatePrompt: { storeUrl?: string } | null = null;

export function consumePendingForceUpdatePrompt(): { storeUrl?: string } | null {
  const pending = pendingForceUpdatePrompt;
  pendingForceUpdatePrompt = null;
  return pending;
}

export function getPendingNotificationNavigation(): string | null {
  // NOTE: this used to clear the stash on read, which meant a failed
  // navigate() (router not ready, Index redirect race) would lose the URL
  // forever. We now peek only; callers MUST invoke
  // `clearPendingNotificationNavigation()` once navigation actually
  // succeeded. `processPendingNotificationNavigation` does this below.
  return pendingNavigationUrl || readPersistedPendingNav();
}


export function clearPendingNotificationNavigation() {
  pendingNavigationUrl = null;
  clearPersistedPendingNav();
  navigationHandled = true;
}

/**
 * Drop any stashed pending notification navigation AND reset the
 * module-level "handled" gate without treating it as a successful launch.
 * Used by `clearUserScopedCaches()` on sign-out / cross-user sign-in so
 * User A's pending push route cannot survive into User B's session in the
 * same tab. Also clears the force-update prompt, which is device-level but
 * safe to re-derive from the next push.
 */
export function clearPendingNotificationLaunchState() {
  pendingNavigationUrl = null;
  clearPersistedPendingNav();
  navigationHandled = false;
  pendingForceUpdatePrompt = null;
}


export function peekPendingNotificationNavigation(): string | null {
  return pendingNavigationUrl || readPersistedPendingNav();
}

export function isNotificationNavigationHandled(): boolean {
  return navigationHandled;
}

// BUG-3 fix: include `game_kickoff` so kickoff push opens the pitch board.
// BUG-4 fix (audit): `check-pending-subs` sends the umbrella push type
// `pitch_board` for pending_sub / half_time / full_time, so include it here
// otherwise warm-tap routing to "/" (the pitch-board open fallback) breaks.
// `full_time` is also added because the underlying sender uses that string.
const PITCH_BOARD_TYPES = new Set([
  'pending_sub',
  'half_time',
  'full_time',
  'game_finished',
  'formation_change',
  'game_kickoff',
  'pitch_board',
]);

function normalizeToPath(url: string): string {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://reference.invalid');
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/notifications';
  } catch {
    if (url.startsWith('/')) return url;
    return `/${url.replace(/^\/+/, '')}`;
  }
}

function isExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const appDomains = ['ignite.invalid', 'lovable.app', 'lovableproject.com', 'localhost'];
    return !appDomains.some(d => parsed.hostname.endsWith(d));
  } catch {
    return false;
  }
}

/**
 * Single handler for a notification tap — used by the one Capacitor listener
 * installed below. Routes to: store/external browser, immediate navigate (if
 * a navigator is registered), or stashes the URL for the post-mount consumer.
 */
function handleNotificationTap(notification: any) {
  try {
    // First mark wins (cold tap); warm taps re-mark so relative timings still
    // reflect this specific navigation instead of the original boot.
    coldMark("notif_tap");
    coldRemark("notif_tap");
    // Begin sampling main-thread blocking so we can attribute the
    // notif_tap → chat_mount gap between JS blocking vs I/O.
    try { startLongTaskWindow("notif_to_chat_mount"); } catch {}
    const data = notification?.notification?.data ?? notification?.data ?? {};
    const rawUrl = data?.url || data?.link || data?.path;
    const url = normalizeNotificationChatUrl(data, rawUrl) || rawUrl;
    console.log('[NotificationLaunch] tap received', {
      notificationId: data?.notificationId ?? data?.id ?? null,
      type: data?.notificationType || data?.type || null,
      message_id: data?.message_id || data?.messageId || null,
      related_id: data?.related_id || null,
      author_id: data?.author_id || data?.sender_id || null,
      rawUrl,
      normalizedUrl: url,
    });
    const storeUrl = data?.store_url;
    const forceUpdatePrompt = data?.force_update_prompt;
    const type = data?.notificationType || data?.type;

    // Force update prompt — open store directly.
    if (forceUpdatePrompt === 'true' || forceUpdatePrompt === true) {
      if (storeUrl) {
        import('@capacitor/browser')
          .then(({ Browser }) => Browser.open({ url: storeUrl }))
          .catch(() => window.open(storeUrl, '_system'));
        navigationHandled = true;
        return;
      }
      pendingForceUpdatePrompt = { storeUrl };
      window.dispatchEvent(new CustomEvent('force-update-prompt', { detail: { storeUrl } }));
      navigationHandled = true;
      return;
    }

    // Store URL (update reminders etc) — external.
    if (storeUrl) {
      import('@capacitor/browser')
        .then(({ Browser }) => Browser.open({ url: storeUrl }))
        .catch(() => window.open(storeUrl, '_system'));
      navigationHandled = true;
      return;
    }

    // Best-effort preload + jump capture.
    try { preloadMessageFromNotification(data); } catch {}
    try { captureJumpFromNotification(data, url); } catch {}
    // Suppress the bottom-nav unread badge contribution for the tapped scope
    // for ~1.5s so the user doesn't see a "flash count then vanish" as the
    // RPC returns the just-arrived message immediately before the chat page
    // marks it read. See src/lib/pushTapSuppression.ts.
    try {
      const target = getJumpTarget(data, url);
      if (target) {
        suppressChatScope(target.kind as SuppressedChatKind, target.targetId, 1800);
      }
    } catch {}
    // Warm the chat page chunk in parallel with auth/profile bootstrap so it
    // is already in the module cache by the time the route mounts.
    try { prefetchChatChunkForUrl(url); } catch {}

    if (url && isExternalUrl(url)) {
      import('@capacitor/browser')
        .then(({ Browser }) => Browser.open({ url }))
        .catch(() => window.open(url, '_system'));
      navigationHandled = true;
      return;
    }

    const isPitchBoard = !!type && PITCH_BOARD_TYPES.has(type);
    const path = url ? normalizeToPath(url) : (isPitchBoard ? '/' : null);

    // Move the global club filter to the club that owns this notification.
    // Called DIRECTLY here (not only via the CustomEvent below) because on a
    // cold start this handler runs before React mounts, so no listener exists
    // yet and the event would be dropped. The stash is sessionStorage-backed
    // and idempotent, so the duplicate call from PushNotificationManager on a
    // warm tap is harmless.
    try { requestClubSwitchForNotification(data, path); } catch { /* noop */ }

    // Broadcast for cross-cutting consumers (active club switch, pitch board open).
    try {
      window.dispatchEvent(new CustomEvent('ignite:notification-tapped', {
        detail: { data, path, type, isPitchBoard },
      }));
    } catch {}

    if (!path) return;

    if (activeNavigator) {
      // Warm tap path: navigate immediately, no need to stash.
      clearPendingNotificationNavigation();
      try {
        coldRemark("route_navigate");
        activeNavigator(path);
      } catch (err) {
        console.warn('[NotificationLaunch] navigator threw, falling back to stash:', err);
        pendingNavigationUrl = path;
        navigationHandled = false;
        persistPendingNav(path);
      }
    } else {
      // Cold start: stash for the post-mount consumer to drain.
      pendingNavigationUrl = path;
      navigationHandled = false;
      persistPendingNav(path);
    }
  } catch (err) {
    console.error('[NotificationLaunch] handleNotificationTap error:', err);
  }
}

/**
 * Initialize notification launch handler.
 * Call this as early as possible in main.tsx.
 */
export function initNotificationLaunchHandler() {
  if (typeof window === 'undefined') return;

  const windowCapacitor = (window as any).Capacitor;
  if (!windowCapacitor || !windowCapacitor.isNativePlatform?.()) {
    console.log('[NotificationLaunch] Not a native platform, skipping');
    return;
  }

  console.log('[NotificationLaunch] Initializing single notification tap listener');

  try {
    PushNotifications.addListener('pushNotificationActionPerformed', handleNotificationTap);
    void checkLaunchNotification(PushNotifications);
  } catch (err) {
    console.warn('[NotificationLaunch] Failed to register PushNotifications listener:', err);
  }
}

async function checkLaunchNotification(PushNotifications: any) {
  try {
    const delivered = await PushNotifications.getDeliveredNotifications();
    console.log('[NotificationLaunch] Delivered notifications:', JSON.stringify(delivered));
  } catch (err) {
    console.warn('[NotificationLaunch] Error checking delivered notifications:', err);
  }
}

/**
 * Process any pending notification navigation.
 * Call this from a React component after the router is ready.
 */
export function processPendingNotificationNavigation(navigate: (path: string) => void): boolean {
  const url = getPendingNotificationNavigation();
  if (!url) return false;

  // Never navigate away from an invite/auth deep-link route the user is
  // currently on — the emailed link is the live intent.
  try {
    if (typeof window !== 'undefined' && INVITE_PATH_RE.test(window.location.pathname)) {
      abandonPendingNotificationNavigation(`on invite route ${window.location.pathname}`);
      return false;
    }
  } catch {}

  let path = url;

  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const urlObj = new URL(url);
      path = urlObj.pathname + urlObj.search + urlObj.hash;
    } catch {
      path = url;
    }
  }
  // Validate: must be a non-empty string starting with '/'. A malformed
  // path causes React Router to render nothing and downstream consumers
  // throw — better to drop the navigation than crash the app.
  if (typeof path !== 'string' || !path.startsWith('/') || path.length < 2) {
    console.warn('[NotificationLaunch] Dropping invalid pending nav path:', path);
    clearPendingNotificationNavigation();
    return false;
  }
  try {
    coldMark("route_navigate");
    navigate(path);
    // Only clear once navigate() returned without throwing. If the router
    // isn't ready yet the caller will retry and pick the URL back up.
    clearPendingNotificationNavigation();
    return true;
  } catch (err) {
    console.error('[NotificationLaunch] navigate threw, will retry:', err);
    return false;
  }

}

