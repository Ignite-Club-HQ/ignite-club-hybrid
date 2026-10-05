import type { FeatureBackendContext } from "@/live/featureRouter";

export interface IcpCancelEventInput {
  event: {
    id: string;
    title?: string | null;
    club_id: string;
    team_id?: string | null;
    mini_league_id?: string | null;
    series_id?: string | null;
    parent_event_id?: string | null;
    is_recurring?: boolean | null;
    starts_at_ms?: number | null;
    event_date?: string | null;
  };
  cancelType: "single" | "series";
  customMessage?: string;
  sendPushNotification?: boolean;
  eventUrl?: string;
}

export interface IcpCancelEventResult {
  cancelledCount: number;
  chatPosted: boolean;
  notifiedCount: number;
}

/**
 * ICP counterpart of the Supabase cancellation flow: cancels one event or
 * every remaining occurrence of its series on events_domain, posts the
 * cancellation notice to the team/club/mini-league chat on messaging_domain,
 * and (optionally) fans out a push notification via notification_queue.
 * The cancel itself must succeed; chat/push are reported, not thrown.
 */
export async function cancelEventOnIcp(
  ctx: FeatureBackendContext,
  input: IcpCancelEventInput,
): Promise<IcpCancelEventResult> {
  const [{ setLiveEventCancelled, setLiveSeriesCancelled, getLiveEventsSnapshot }, { sendLiveMessage }, { fanOutLiveNotifications }, { listLiveTeamRoleGrants, listLiveRoleGrants }] =
    await Promise.all([
      import("@/live/features/events"),
      import("@/live/features/messaging"),
      import("@/live/features/notifications"),
      import("@/live/features/membership"),
    ]);

  const { event } = input;
  let cancelledCount = 0;
  let seriesId = event.series_id ?? null;
  let fromMs = event.starts_at_ms ?? 0;
  if (input.cancelType === "series" && !seriesId) {
    const snapshot = await getLiveEventsSnapshot(ctx);
    const live = (snapshot.events as Array<{ id: string; series_id: [] | [string]; starts_at_ms: bigint }>)
      .find((e) => e.id === event.id);
    seriesId = live?.series_id?.[0] ?? null;
    if (live) fromMs = Number(live.starts_at_ms);
  }

  if (input.cancelType === "series" && seriesId) {
    // Cancel every occurrence from this one onwards (past ones stay as played).
    cancelledCount = Number(await setLiveSeriesCancelled(ctx, seriesId, true, fromMs));
  } else {
    await setLiveEventCancelled(ctx, event.id, true);
    cancelledCount = 1;
  }

  const title = event.title ?? "Event";
  const lines = [`📢 Event Cancelled: "${title}"`];
  if (input.customMessage?.trim()) lines.push(input.customMessage.trim());
  if (input.eventUrl) lines.push(`View event: ${input.eventUrl}`);
  const body = lines.join("\n\n");

  const conversationId = event.mini_league_id || event.team_id || event.club_id;
  let chatPosted = false;
  try {
    await sendLiveMessage(ctx, conversationId, body, `event-cancel:${event.id}:${input.cancelType}`);
    chatPosted = true;
  } catch (err) {
    console.warn("[CancelEvent] ICP chat notice failed", err);
  }

  let notifiedCount = 0;
  if (input.sendPushNotification) {
    try {
      const grants = event.team_id
        ? await listLiveTeamRoleGrants(ctx, event.team_id)
        : await listLiveRoleGrants(ctx, event.club_id);
      const me = ctx.identity.getPrincipal().toText();
      const userIds = [...new Set(grants.map((g: any) => g.user?.toText?.() ?? String(g.user)))].filter((id) => id && id !== me);
      if (userIds.length > 0) {
        notifiedCount = Number(
          await fanOutLiveNotifications(ctx, {
            userIds,
            clubId: event.club_id,
            kind: "event_cancelled",
            body: `Event cancelled: ${title}`,
            idempotencyKeyPrefix: `event-cancel-${event.id}-${Date.now()}`,
            relatedId: event.id,
          }),
        );
      }
    } catch (err) {
      console.warn("[CancelEvent] ICP push fan-out failed", err);
    }
  }

  return { cancelledCount, chatPosted, notifiedCount };
}
