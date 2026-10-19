/**
 * ICP notification tap -> in-app route.
 *
 * The notification_queue canister has no per-type route metadata (chat/event
 * containers live in Supabase-shaped tables that don't exist on-chain), so
 * ICP notification rows carry just `kind`, `related_id`, `club`, and
 * `idempotency_key` (doubling as the message id for chat notifications — see
 * backend/notification_queue/src/main.mo ~955-972). This resolves a route the
 * same way the Supabase switches in AppHeader.tsx / NotificationsPage.tsx do.
 */
import type { FeatureBackendContext } from "@/live/featureRouter";

export interface IcpNotificationRouteInput {
  kind: string;
  relatedId: string | null;
  club: string | null;
  messageId: string | null;
}

const FALLBACK = "/notifications";

/**
 * message_chat conversation ids double as the on-chain conversation's id
 * (club/team chat use the club/team id directly; club-admin threads use
 * `club-admin-<clubId>-<member>`; groups/DMs use a canister-generated id).
 * The conversation's canonical `kind` string (see messaging_domain's
 * `inferConversationKind` / `ensure_*` helpers) is the only reliable way to
 * tell them apart, so look it up instead of guessing from the id shape.
 */
async function resolveChatRoute(
  ctx: FeatureBackendContext,
  conversationId: string,
  messageId: string | null,
): Promise<string> {
  const suffix = messageId ? `?message=${messageId}` : "";
  try {
    const { getLiveGroupMetadata } = await import("@/live/features/messaging");
    const { withFeatureBackend } = await import('@/live/featureRouter');
    const meta = await withFeatureBackend('messaging', {
      supabase: async () => { throw new Error('ICP chat required'); },
      icp: scoped => getLiveGroupMetadata(scoped, conversationId),
    }, { conversationId });
    switch (meta?.kind) {
      case "team":
        return `/messages/${conversationId}${suffix}`;
      case "club":
        return `/messages/club/${conversationId}${suffix}`;
      case "club_admin":
        return `/messages/club-admin/${conversationId}${suffix}`;
      case "group":
      case "competition":
        return `/groups/${conversationId}${suffix}`;
      case "direct":
        return `/messages/dm/${conversationId}${suffix}`;
      case "broadcast":
        return `/messages/broadcast${suffix}`;
      default:
        break;
    }
  } catch {
    // Metadata lookup failed (offline, canister error) — fall back to the
    // one shape we can recognise without it.
  }
  if (conversationId.startsWith("club-admin-")) {
    return `/messages/club-admin/${conversationId}${suffix}`;
  }
  // DM conversations are created as `dm-<n>` (see messaging_domain's
  // send_welcome_message / send_system_message) and have no group metadata,
  // so recognise the shape directly — otherwise welcome/support DM taps
  // landed back on the message list the user was already viewing.
  if (conversationId.startsWith("dm-")) {
    return `/messages/dm/${conversationId}${suffix}`;
  }
  return "/messages";
}

/**
 * Resolves the deep link for one ICP inbox notification. Mirrors (a subset
 * of) the Supabase `related_id`-based switch in AppHeader.tsx / NotificationsPage.tsx;
 * unmapped kinds fall back to the notifications inbox.
 */
export async function getIcpNotificationRoute(
  ctx: FeatureBackendContext,
  notification: IcpNotificationRouteInput,
): Promise<string> {
  const { kind, relatedId, club, messageId } = notification;
  if (kind === "message_chat") {
    const conversationId = club ?? relatedId;
    if (!conversationId) return "/messages";
    return resolveChatRoute(ctx, conversationId, messageId);
  }
  if (!relatedId) return FALLBACK;

  switch (kind) {
    case "media_chat_photo_reminder":
      return `/media?team=${encodeURIComponent(relatedId)}&upload=1`;
    case "event_invite":
    case "event_cancelled":
    case "event_updated":
    case "event_reminder":
    case "event_view_reminder":
    case "duty_assigned":
    case "duty_completed":
    case "rsvp":
    case "rsvp_update":
    case "rsvp_updated":
      return `/events/${relatedId}`;
    case "photo_prompt_reminder": {
      // related_id is the game event id — open that team's gallery with the
      // upload sheet, matching the Supabase tap handler.
      try {
        const { listLiveEvents } = await import("@/live/features/events");
        const { withFeatureBackend } = await import('@/live/featureRouter');
        const events = (await withFeatureBackend('events', {
          supabase: async () => [], icp: scoped => listLiveEvents(scoped),
        }, { eventId: relatedId })) as Array<{ id?: string; team_id?: [] | [string] }>;
        const ev = (events ?? []).find((e) => e?.id === relatedId);
        const team = ev && Array.isArray(ev.team_id) && ev.team_id.length > 0 ? ev.team_id[0] : null;
        if (team) return `/media?team=${team}&event=${relatedId}&upload=1`;
      } catch {
        // fall through to the plain upload sheet
      }
      return "/media?upload=1";
    }
    case "club_news":
      return `/news/${relatedId}`;
    case "club_join":
      return `/clubs/${relatedId}`;
    case "role_assigned":
    case "invite_accepted":
    case "team_join":
    case "membership":
    case "role_removed":
      return `/teams/${relatedId}`;
    default:
      return FALLBACK;
  }
}
