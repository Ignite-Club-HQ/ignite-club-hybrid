/**
 * Pre-hydrate the message cache from an incoming push notification payload so
 * that when the user taps the notification and the chat page mounts, the new
 * message is already visible at first paint instead of appearing 2–5 seconds
 * later when the network fetch / realtime subscription finally lands.
 *
 * This is intentionally tolerant: if any required field is missing, we simply
 * no-op and the page falls back to today's behaviour (stale cache + refetch).
 *
 * Companion helper `consumeFromNotificationFlag` lets a chat page detect that
 * it was opened from a notification within the last 60s, so it can skip the
 * stale `placeholderData` render and force a priority refetch.
 */
import { addMessageToCache, type CachedMessage } from "@/lib/messageCache";
import { NOTIFICATION_PRELOAD_FLAG } from "@/lib/chatThreadLoadState";

type ChatKind = "dm" | "team" | "club" | "group" | "broadcast" | "club_admin";

const FLAG_PREFIX = "ignite_from_notification_";
const FLAG_TTL_MS = 60_000;

interface ParsedPreload {
  kind: ChatKind;
  targetId: string;
  message: CachedMessage;
}

function parsePayload(data: any): ParsedPreload | null {
  if (!data || typeof data !== "object") return null;

  const messageId: string | undefined = data.message_id || data.messageId || data.related_id || data.relatedId;
  const text: string | undefined = typeof data.text === "string" ? data.text : data.body;
  const authorId: string | undefined = data.author_id || data.authorId || data.sender_id;
  const createdAt: string | undefined = data.created_at || data.createdAt || new Date().toISOString();
  if (!messageId || !authorId) return null;

  // Determine target conversation/chat. Order matters — DM first because some
  // payloads include both conversation_id and team_id (e.g. cross-posts).
  // Club-admin messages also carry conversation_id, so detect those before DM.
  let kind: ChatKind | null = null;
  let targetId: string | undefined;
  const notificationType = data.notificationType || data.type;
  const isAdminThread =
    notificationType === "club_admin_message" ||
    data.is_admin_thread === true ||
    data.is_admin_thread === "true";

  if (isAdminThread && (data.context_id || data.contextId || data.conversation_id || data.conversationId)) {
    kind = "club_admin";
    targetId = data.context_id || data.contextId || data.conversation_id || data.conversationId;
  } else if (data.conversation_id || data.conversationId) {
    kind = "dm";
    targetId = data.conversation_id || data.conversationId;
  } else if (data.group_id || data.groupId) {
    kind = "group";
    targetId = data.group_id || data.groupId;
  } else if (data.team_id || data.teamId) {
    kind = "team";
    targetId = data.team_id || data.teamId;
  } else if (data.club_id || data.clubId) {
    // BUG-7: FCM serializes all data fields as strings, so accept both.
    kind = isAdminThread ? "club_admin" : "club";
    targetId = data.club_id || data.clubId;
  } else if (data.broadcast_id || data.broadcastId) {
    kind = "broadcast";
    targetId = data.broadcast_id || data.broadcastId;
  }
  if (!kind || !targetId) return null;

  const displayName = data.author_display_name || data.sender_name;
  const message: CachedMessage = {
    id: messageId,
    text: text || "",
    author_id: authorId,
    created_at: createdAt,
    image_url: data.image_url || null,
    reply_to_id: data.reply_to_id || null,
    profiles: displayName
      ? {
          display_name: displayName,
          avatar_url: data.author_avatar_url || null,
        }
      : null,
    reactions: [],
    reply_to: null,
    // Marks this row as an incomplete notification-only preload so chat
    // pages can distinguish it from a genuine cached one-message thread.
    [NOTIFICATION_PRELOAD_FLAG]: true,
  };


  return { kind, targetId, message };
}

/**
 * Best-effort: write the inbound message into the local cache so the chat page
 * shows it instantly, and set a flag so the page knows it was opened from a
 * notification (and should bypass stale placeholders).
 */
export function preloadMessageFromNotification(data: any): void {
  try {
    const parsed = parsePayload(data);
    if (!parsed) return;
    addMessageToCache(parsed.kind, parsed.targetId, parsed.message);
    setFromNotificationFlag(parsed.kind, parsed.targetId);
    // Notify any mounted listener (PushNotificationManager) so it can also
    // merge the message into the live React Query cache — placeholderData
    // only runs on a cold mount; without this, an already-mounted chat
    // would not show the new message until refetch completes.
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ignite:preload-message", {
          detail: { kind: parsed.kind, targetId: parsed.targetId, message: parsed.message },
        }));
      }
    } catch {}
  } catch (err) {
    console.warn("[notificationPreload] Failed to preload message", err);
  }
}


function flagKey(kind: ChatKind, targetId: string): string {
  return `${FLAG_PREFIX}${kind}_${targetId}`;
}

export function setFromNotificationFlag(kind: ChatKind, targetId: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(flagKey(kind, targetId), String(Date.now()));
  } catch {
    // ignore
  }
}

/**
 * Returns the push-tap timestamp (ms epoch) if this chat was opened from a
 * notification in the last 60s, otherwise null. The flag is consumed on read
 * so it only applies to the very next mount of the corresponding chat page.
 */
export function consumeFromNotificationFlag(kind: ChatKind, targetId: string): number | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const key = flagKey(kind, targetId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return null;
    if (Date.now() - ts > FLAG_TTL_MS) return null;
    return ts;
  } catch {
    return null;
  }
}

/**
 * Sweep every `ignite_from_notification_*` flag from sessionStorage. Called
 * by `clearUserScopedCaches()` on sign-out / cross-user sign-in so User A's
 * "opened from notification" hints cannot flip User B's chat pages into
 * refetch-priority mode on first mount. Safe/idempotent.
 */
export function clearAllFromNotificationFlags(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(FLAG_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) {
      try { sessionStorage.removeItem(k); } catch { /* noop */ }
    }
  } catch {
    /* noop */
  }
}

