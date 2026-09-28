/**
 * On-device debug log capture for notification-tap → chat-jump diagnostics.
 *
 * Enable on any device by visiting `?notifdebug=1` once (persists in
 * localStorage as `ignite_notif_debug=1`). Disable with `?notifdebug=0`.
 *
 * When enabled, console.log/info/warn/error calls whose stringified payload
 * contains any of the KEYWORDS below are mirrored into an in-memory ring
 * buffer. The `NotifDebugOverlay` component reads/subscribes to the buffer
 * and renders a floating panel so logs can be read straight from the phone
 * (no USB cable needed).
 *
 * Scoped strictly to notification/chat-jump diagnostics so the buffer never
 * fills with noise from unrelated subsystems.
 */

const STORAGE_KEY = "ignite_notif_debug";
const MAX_ENTRIES = 200;

const KEYWORDS = [
  "NotificationLaunch",
  "NativePush",
  "pendingChatJump",
  "PendingChatJump",
  "bottomPin",
  "BottomPin",
  "chat:jump",
  "jump-",
  "jumpToMessage",
  "targetMessage",
  "scrollToIndex",
  "preloadMessage",
  "normalizeNotification",
  "ChatJump",
  "AppHeaderNotifTap",
  "InAppNotifTap",
  "WebNotificationLaunch",
];

export interface NotifDebugEntry {
  ts: number;
  level: "log" | "info" | "warn" | "error";
  text: string;
}

let buffer: NotifDebugEntry[] = [];
const listeners = new Set<() => void>();
let installed = false;

export function isNotifDebugEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    const param = params.get("notifdebug");
    if (param === "1" || param === "true") {
      localStorage.setItem(STORAGE_KEY, "1");
      return true;
    }
    if (param === "0" || param === "false") {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function getNotifDebugBuffer(): NotifDebugEntry[] {
  return buffer;
}

export function clearNotifDebugBuffer(): void {
  buffer = [];
  listeners.forEach((fn) => fn());
}

export function subscribeNotifDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function push(level: NotifDebugEntry["level"], args: unknown[]): void {
  let text = "";
  try {
    text = args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
  } catch {
    text = String(args);
  }
  if (!KEYWORDS.some((k) => text.includes(k))) return;
  buffer.push({ ts: Date.now(), level, text: text.slice(0, 600) });
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  listeners.forEach((fn) => fn());
}

export function installNotifDebugCapture(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (!isNotifDebugEnabled()) return;
  installed = true;
  (["log", "info", "warn", "error"] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try { push(level, args); } catch { /* noop */ }
      original(...args);
    };
  });
  push("info", ["[NotifDebug] capture installed"]);
}
