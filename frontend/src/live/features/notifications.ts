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
