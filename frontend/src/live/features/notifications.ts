import { connectLiveNotificationQueue } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { unwrapCandid, unwrapCandidOpt } from "./candid";

/**
 * Notifications feature -> notification_queue canister.
 *
 * The canister is a durable enqueue/claim/ack pipeline: the app enqueues,
 * delivery workers claim and acknowledge. Only the app-facing surface
 * (enqueue + status lookup) is exposed here; claim/ack/fail/recover are
 * worker operations and belong to the delivery service, not the browser.
 *
 * NOTE: untested against a live canister until deployment.
 */

export interface LiveNotificationInput {
  /** Client-generated id, doubles as the idempotency key namespace. */
  id: string;
  userId: string;
  clubId: string;
  kind: string;
  body: string;
  idempotencyKey: string;
}

export async function enqueueLiveNotification(
  ctx: FeatureBackendContext,
  input: LiveNotificationInput,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.enqueue(input.id, input.userId, input.clubId, input.kind, input.body, input.idempotencyKey),
    "Enqueue notification",
  );
}

export async function getLiveNotification(ctx: FeatureBackendContext, notificationId: string) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandidOpt(await actor.get_notification(notificationId), "Get notification");
}

/**
 * Browser inbox surface. The canister stores the app account id as plain
 * text and cannot verify it against the caller's principal — inbox reads and
 * mutations are provisional until account ids are bound to principals
 * (identity_access), matching the rest of the live feature layer.
 */
export async function listLiveInbox(
  ctx: FeatureBackendContext,
  userId: string,
  clubId: string | null,
  limit = 500,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_inbox(userId, clubId ? [clubId] : [], limit),
    "List inbox",
  );
}

export async function markLiveNotificationRead(ctx: FeatureBackendContext, notificationId: string) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(actor.mark_read(notificationId), "Mark notification read");
}

export async function markAllLiveNotificationsRead(
  ctx: FeatureBackendContext,
  userId: string,
  clubId: string | null,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.mark_all_read(userId, clubId ? [clubId] : []),
    "Mark all notifications read",
  );
}

export async function deleteLiveNotification(ctx: FeatureBackendContext, notificationId: string) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_notification(notificationId), "Delete notification");
}

export async function clearLiveInbox(
  ctx: FeatureBackendContext,
  userId: string,
  clubId: string | null,
) {
  const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.clear_inbox(userId, clubId ? [clubId] : []),
    "Clear inbox",
  );
}
