/**
 * Resilient "scroll to this message" handoff for push-notification taps.
 *
 * Background: on Android cold-start, the FCM payload URL like
 * `/messages/{teamId}?message={msgId}` is delivered to the JS layer, but
 * the `?message=` search param is sometimes lost between the
 * `pushNotificationActionPerformed` callback firing, the auth bootstrap
 * navigating around, and the chat page mounting — so the chat opens but
 * never scrolls to the new message.
 *
 * As a safety net, every push handler that knows the message id stores it
 * here, and every chat page reads it on mount as a fallback when the URL
 * search param is missing. Entries expire after 60s so old taps can't
 * hijack a future page mount.
 */

import { setFromNotificationFlag } from "@/lib/notificationPreload";
import { setChatJumpActive, isChatJumpActive } from "@/lib/chatJumpActive";

/**
 * Safety timeout (ms) for the eagerly-armed chatJumpActive flag set when a
 * push notification with a message target is captured BEFORE the chat page
 * has mounted. If `jumpToMessageInVirtualizedChat` never actually fires
 * (e.g. user navigated away, target page mismatch, network failure during
 * page-chunk fetch), this auto-clears so future scroll behaviour isn't
 * permanently broken.
 *
 * Generous enough to cover cold-start + auth bootstrap + chat-page mount on
 * slow Android devices; tight enough to recover before the next user
 * interaction needs a fresh scroll.
 */
// Slow Android cold starts (auth bootstrap + React mount + chat chunk load)
// regularly exceed 4s. If the timer fires before VirtualizedChatMessageList
// mounts, the jump-hydration overlay is never shown and the user sees the
// 1-message preload stranded at the top. 10s is generous enough to cover the
// slowest cold-start path but still recovers before the user's next gesture.
const EAGER_JUMP_ARM_TIMEOUT_MS = 10_000;
let eagerJumpClearTimer: ReturnType<typeof setTimeout> | null = null;

function armEagerChatJump(): void {
  // Don't clobber an already-active jump (e.g. user is mid-search-result-tap).
  if (!isChatJumpActive()) setChatJumpActive(true);
  if (eagerJumpClearTimer) clearTimeout(eagerJumpClearTimer);
  eagerJumpClearTimer = setTimeout(() => {
    eagerJumpClearTimer = null;
    // Only clear if no real jump took ownership — `jumpToMessageInVirtualizedChat`
    // calls setChatJumpActive(false) itself in its end-hydration path, so if it
    // ran and finished we'll already be false here; if it's still running we
    // leave it alone.
    if (isChatJumpActive()) setChatJumpActive(false);
  }, EAGER_JUMP_ARM_TIMEOUT_MS);
}

const STORAGE_KEY = "ignite_pending_chat_jump_v1";
const TTL_MS = 60_000;
const JUMP_EVENT = "ignite:pending-chat-jump";
let lastConsumedJump: StoredJump | null = null;

export type ChatJumpKind = "team" | "club" | "group" | "dm" | "broadcast" | "club_admin";

interface StoredJump {
  kind: ChatJumpKind;
  targetId: string | null; // null for broadcast
  messageId: string;
  ts: number;
}

interface ChatJumpTarget {
  kind: ChatJumpKind;
  targetId: string | null;
  messageId: string;
}

export type PendingChatJumpPayload = StoredJump;

export function withChatJumpNonce(to: string, nonce: number = Date.now()): string {
  try {
    const parsed = new URL(to, "https://reference.invalid");
    if (parsed.searchParams.has("message")) {
      parsed.searchParams.set("jump", String(nonce));
    }
    const out = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    try {
      const stack = new Error("withChatJumpNonce trace").stack?.split("\n").slice(1, 6).join(" | ");
      console.log("[ChatJump] withChatJumpNonce", { in: to, out, stack });
    } catch { /* ignore */ }
    return out;
  } catch {
    return to;
  }
}

export function subscribePendingChatJump(handler: (jump: PendingChatJumpPayload) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PendingChatJumpPayload>).detail;
    if (detail?.kind && detail?.messageId) handler(detail);
  };
  window.addEventListener(JUMP_EVENT, listener);
  return () => window.removeEventListener(JUMP_EVENT, listener);
}

function read(): StoredJump | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredJump;
    if (!parsed?.messageId || !parsed?.kind) return null;
    if (Date.now() - parsed.ts > TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setPendingChatJump(kind: ChatJumpKind, targetId: string | null, messageId: string): void {
  const payload: StoredJump = { kind, targetId, messageId, ts: Date.now() };
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: payload }));
    }
  } catch {
    /* ignore */
  }
}

export function getLastConsumedPendingChatJumpTs(messageId: string | null): number | undefined {
  if (!messageId) return undefined;
  return lastConsumedJump?.messageId === messageId ? lastConsumedJump.ts : undefined;
}

function pickMessageId(data: any, parsed?: URL): string | null {
  // IMPORTANT: prefer the explicit `data.message_id` (set fresh per push by
  // process-message-notifications) over the URL `?message=` param. The URL
  // string can be stale across notifications in narrow edge cases (Android
  // intent extras re-use, withChatJumpNonce re-encoding, cached deep links),
  // but the data payload is rebuilt for every push and is the authoritative
  // source. This prevents the symptom where tapping a newer push from the
  // same sender opens an older message in the same thread.
  const explicitMessageId =
    data?.message_id ||
    data?.messageId ||
    data?.messageID ||
    data?.target_message_id ||
    data?.targetMessageId ||
    parsed?.searchParams.get("message") ||
    null;
  if (explicitMessageId) {
    try {
      const urlMsg = parsed?.searchParams.get("message");
      if (urlMsg && urlMsg !== explicitMessageId) {
        console.warn("[ChatJump] URL ?message= disagrees with data.message_id; using data.message_id", {
          urlMessageId: urlMsg,
          dataMessageId: explicitMessageId,
        });
      }
    } catch { /* noop */ }
    return explicitMessageId;
  }

  // Direct-message notifications historically stored the conversation id in
  // related_id. Never treat that as a message id unless an explicit message id
  // is also present, otherwise multiple pushes from the same sender can all
  // collapse to an arbitrary/latest message in that conversation.
  const type = String(data?.notificationType || data?.type || "");
  if (type === "direct_message") return null;

  // Other message notification rows store the exact message id in related_id.
  return data?.related_id || data?.relatedId || null;
}

export function getJumpTarget(data: any, url: string | null | undefined): ChatJumpTarget | null {
  if (!url && !data) return null;
  try {
    const parsed = url ? new URL(url, "https://reference.invalid") : undefined;
    const path = parsed?.pathname ?? "";
    const messageId = pickMessageId(data, parsed);
    if (!messageId) return null;

    const fromPath = (kind: ChatJumpKind, targetId: string | null): ChatJumpTarget => ({ kind, targetId, messageId });
    let m = path.match(/^\/messages\/dm\/([^/]+)/);
    if (m) return fromPath("dm", m[1]);
    m = path.match(/^\/messages\/club-admin\/([^/]+)/);
    if (m) return fromPath("club_admin", m[1]);
    m = path.match(/^\/messages\/club\/([^/]+)/);
    if (m) return fromPath("club", m[1]);
    m = path.match(/^\/messages\/group\/([^/]+)/);
    if (m) return fromPath("group", m[1]);
    if (path === "/messages/broadcast" || path.startsWith("/messages/broadcast/")) return fromPath("broadcast", null);
    m = path.match(/^\/groups\/([^/]+)/);
    if (m) return fromPath("group", m[1]);
    m = path.match(/^\/messages\/([^/]+)/);
    if (m && !["dm", "club", "club-admin", "group", "broadcast"].includes(m[1])) return fromPath("team", m[1]);

    const type = String(data?.notificationType || data?.type || "");
    const contextId = data?.context_id || data?.contextId;
    if (data?.group_id || data?.groupId || type === "group_message") return fromPath("group", data?.group_id || data?.groupId || contextId);
    if (data?.team_id || data?.teamId || type === "team_message") return fromPath("team", data?.team_id || data?.teamId || contextId);
    if (type === "club_admin_message" || data?.is_admin_thread === true || data?.is_admin_thread === "true") return fromPath("club_admin", data?.conversation_id || data?.conversationId || contextId);
    if (type === "direct_message") return fromPath("dm", data?.conversation_id || data?.conversationId || contextId);
    if (data?.club_id || data?.clubId || type === "club_message") return fromPath("club", data?.club_id || data?.clubId || contextId);
    if (type === "broadcast" || data?.broadcast_id || data?.broadcastId) return fromPath("broadcast", null);
  } catch {
    return null;
  }
  return null;
}

export function normalizeNotificationChatUrl(data: any, url: string | null | undefined): string | null {
  if (!url) return null;
  // Guard: never rewrite non-chat URLs into a chat jump. Photo / media /
  // schedule pushes carry their own SPA path in `url` and may also include
  // `team_id` / `club_id` hints in the payload (used for scoping). Without
  // this guard, getJumpTarget's payload-based fallback would turn
  // `/media?photo=<id>&team=<team_id>` into
  // `/messages/<team_id>?message=<photo_id>` — landing the user in the wrong
  // team chat with the photo id treated as a message id.
  try {
    const path = new URL(url, "https://reference.invalid").pathname;
    const isChatPath = path.startsWith("/messages") || path.startsWith("/groups/");
    if (!isChatPath) return url;
  } catch {
    return url;
  }
  const target = getJumpTarget(data, url);
  if (!target) return url;

  const jumpNonce = Date.now();

  const basePath = (() => {
    switch (target.kind) {
      case "dm": return target.targetId ? `/messages/dm/${target.targetId}` : "/messages";
      case "club_admin": return target.targetId ? `/messages/club-admin/${target.targetId}` : "/messages";
      case "club": return target.targetId ? `/messages/club/${target.targetId}` : "/messages";
      case "group": return target.targetId ? `/groups/${target.targetId}` : "/messages";
      case "broadcast": return "/messages/broadcast";
      case "team": return target.targetId ? `/messages/${target.targetId}` : "/messages";
    }
  })();
  const parsed = new URL(url, "https://reference.invalid");
  const next = new URL(basePath, "https://reference.invalid");
  parsed.searchParams.forEach((value, key) => next.searchParams.set(key, value));
  next.searchParams.set("message", target.messageId);
  next.searchParams.set("jump", String(jumpNonce));
  next.hash = parsed.hash;
  return `${next.pathname}${next.search}${next.hash}`;
}

/**
 * Returns the stored message id (and removes it) when the stored jump
 * matches the given chat. Use on chat-page mount as a fallback when the
 * URL `?message=` search param is missing.
 */
export function consumePendingChatJump(kind: ChatJumpKind, targetId: string | null): string | null {
  const stored = read();
  if (!stored) return null;
  if (stored.kind !== kind) return null;
  if ((stored.targetId ?? null) !== (targetId ?? null)) return null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  lastConsumedJump = stored;
  return stored.messageId;
}

/**
 * Drop the pending chat-jump target and reset module-level "last consumed"
 * memoisation. Used by `clearUserScopedCaches()` on sign-out / cross-user
 * sign-in so User A's tapped message id cannot influence User B's chat page
 * mount in the same tab. Also cancels the eager jump-active arming timer so
 * User B's chat pages don't skip their initial bottom-pin.
 */
export function clearPendingChatJumpState(): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  lastConsumedJump = null;
  if (eagerJumpClearTimer) {
    clearTimeout(eagerJumpClearTimer);
    eagerJumpClearTimer = null;
  }
  try { setChatJumpActive(false); } catch { /* noop */ }
}


/**
 * Best-effort: derive (kind, targetId, messageId) from a notification
 * payload + URL and persist them so the chat page can pick up the jump
 * even if the search param is stripped during navigation.
 */
export function captureJumpFromNotification(data: any, url: string | null | undefined): void {
  // Same non-chat guard as normalizeNotificationChatUrl — never stash a
  // pending chat jump for /media, /schedule, /profile, etc. pushes.
  if (url) {
    try {
      const path = new URL(url, "https://reference.invalid").pathname;
      const isChatPath = path.startsWith("/messages") || path.startsWith("/groups/");
      if (!isChatPath) return;
    } catch {
      return;
    }
  }
  const target = getJumpTarget(data, url);
  if (!target) return;
  setPendingChatJump(target.kind, target.targetId, target.messageId);
  if (target.targetId) setFromNotificationFlag(target.kind, target.targetId);
  // Eagerly arm the bottom-pin bail-out flag so on-mount pin compensators on
  // VirtualizedChatMessageList / useInitialChatBottomPin skip their initial
  // scrollToBottom — otherwise the cold-start tap races
  // jumpToMessageInVirtualizedChat and the user momentarily lands at the
  // newest message before the jump kicks in (~200–500ms of visible jitter).
  armEagerChatJump();
}
