/**
 * Web equivalent of `notificationLaunchHandler` for native: installed in
 * main.tsx BEFORE React mounts so that BroadcastChannel / postMessage
 * navigation events fired by the service worker are never missed while the
 * page is booting (auth bootstrap, profile load, etc.).
 *
 * Stashes the URL and triggers an optional message-cache preload so the chat
 * page can render the new push message at first paint.
 */
import { preloadMessageFromNotification } from "./notificationPreload";
import { captureJumpFromNotification, normalizeNotificationChatUrl } from "./pendingChatJump";
import { prefetchChatChunkForUrl } from "./chatChunkPrefetch";
import { requestClubSwitchForNotification } from "./notificationClubSwitch";
import { mark as coldMark, remark as coldRemark, startLongTaskWindow } from "./coldStartMarks";

let pendingUrl: string | null = null;
const SS_KEY = "ignite_pending_web_push_nav";

function persist(url: string) {
  try { sessionStorage.setItem(SS_KEY, url); } catch {}
}

function readPersisted(): string | null {
  try { return sessionStorage.getItem(SS_KEY); } catch { return null; }
}

function clearPersisted() {
  try { sessionStorage.removeItem(SS_KEY); } catch {}
}

export function consumePendingWebPushNav(): string | null {
  const url = pendingUrl || readPersisted();
  if (url) {
    pendingUrl = null;
    clearPersisted();
  }
  return url;
}

/**
 * Drop any stashed pending web-push navigation without consuming it as a
 * launch. Used by `clearUserScopedCaches()` on sign-out / cross-user sign-in
 * so the previous user's pending route cannot leak to the next user in the
 * same tab.
 */
export function clearPendingWebPushNav(): void {
  pendingUrl = null;
  clearPersisted();
}


function isExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const appDomains = ['ignite.invalid', 'lovable.app', 'lovableproject.com', 'localhost'];
    return !appDomains.some((d) => parsed.hostname.endsWith(d));
  } catch {
    return false;
  }
}

function handlePayload(payload: any) {
  if (!payload) return;
  coldMark("notif_tap");
  coldRemark("notif_tap");
  try { startLongTaskWindow("notif_to_chat_mount"); } catch {}
  const data = payload.data || payload;
  // Mirror native payload extraction. FCM/web-push producers have used both
  // top-level and nested `url`/`link`/`path` fields over time; ignoring those
  // variants opens no reliable route/switch handoff on a resumed web client.
  const rawUrl: string | undefined =
    payload.url || payload.link || payload.path || data?.url || data?.link || data?.path;
  console.log("[WebNotificationLaunch] tap received", {
    notificationId: data?.notificationId ?? data?.id ?? null,
    type: data?.notificationType || data?.type || null,
    message_id: data?.message_id || data?.messageId || null,
    related_id: data?.related_id || null,
    author_id: data?.author_id || data?.sender_id || null,
    rawUrl,
  });

  // Audit fix: mirror native handler — force-update / store_url notifications
  // carry no SPA url, only a store link. Open it in a new tab instead of
  // navigating the SPA to `undefined`.
  const storeUrl: string | undefined = data?.store_url || payload?.store_url;
  const forceUpdate = data?.force_update_prompt === true || data?.force_update_prompt === 'true';
  if (forceUpdate || storeUrl) {
    if (storeUrl) {
      try { window.open(storeUrl, '_blank', 'noopener'); } catch {}
    }
    try {
      window.dispatchEvent(new CustomEvent('force-update-prompt', { detail: { storeUrl } }));
    } catch {}
    return;
  }

  // External (non-app-domain) URLs should open in a new tab, not be stashed
  // as an SPA route.
  if (rawUrl && isExternalUrl(rawUrl)) {
    try { window.open(rawUrl, '_blank', 'noopener'); } catch {}
    return;
  }

  const url = normalizeNotificationChatUrl(data, rawUrl) || rawUrl;
  if (url) {
    pendingUrl = url;
    persist(url);
    // Persist the exact message target before React navigation starts, so
    // chat pages can still jump correctly if the search param is dropped.
    try { captureJumpFromNotification(data, url); } catch {}
    // Warm the chat page chunk in parallel with auth/profile bootstrap so it
    // is already in the module cache by the time the route mounts.
    try { prefetchChatChunkForUrl(url); } catch {}
    // Bring the global club filter to the club that owns this thread, so the
    // app doesn't open a Club B chat while still filtered to Club A.
    try { requestClubSwitchForNotification(data, url); } catch {}
  }
  // Best-effort preload — payload may contain the full push data so the chat
  // page can render the new message instantly. Safe no-op if fields missing.
  try {
    preloadMessageFromNotification(data);
  } catch {}
}

let installed = false;

export function initWebNotificationLaunchHandler() {
  if (installed) return;
  installed = true;
  if (typeof window === "undefined") return;
  // Skip on native — native uses its own launch handler
  if ((window as any).Capacitor?.isNativePlatform?.()) return;

  try {
    const bc = new BroadcastChannel("push-nav");
    bc.onmessage = (event) => {
      handlePayload(event.data);
    };
  } catch {}

  try {
    navigator.serviceWorker?.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.type === "NOTIFICATION_CLICK_NAVIGATE") {
        handlePayload(event.data);
      }
    });
  } catch {}
}
