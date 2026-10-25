import { withFeatureBackend, type FeatureBackendContext } from "./featureRouter";
import { getLivePushDeliveryHealth, getLivePushAlertSettings, upsertLivePushAlertSettings, cleanupLiveStaleDeviceTokens, type LivePushAlertSettingsInput } from "./features/notifications";

const unavailable = async (): Promise<never> => { throw new Error("Internet Identity connection required"); };
export async function adminQueueContexts(): Promise<FeatureBackendContext[]> {
  // Each source read is checked against the full registry before contexts
  // publish. Never treat a partial multi-group reply as the full inventory.
  return withFeatureBackend<FeatureBackendContext[]>("notifications", {
    supabase: unavailable, icp: async ctx => [ctx],
  }, { everyGroup: true, requireComplete: true, merge: parts => [...new Map((parts as FeatureBackendContext[][]).flat().map(ctx => [ctx.target.canisterIds.notification_queue, ctx])).values()] });
}
export async function readAdminQueueHealth() {
  const contexts = await adminQueueContexts();
  return Promise.all(contexts.map(async ctx => ({ queue: ctx.target.canisterIds.notification_queue, ...await getLivePushDeliveryHealth(ctx, Date.now()) })));
}
export async function readAdminQueueSettings() {
  const contexts = await adminQueueContexts();
  return Promise.all(contexts.map(async ctx => ({ queue: ctx.target.canisterIds.notification_queue, ...await getLivePushAlertSettings(ctx) })));
}
export async function saveAdminQueueSettings(value: LivePushAlertSettingsInput) {
  const contexts = await adminQueueContexts();
  let completed = 0;
  try { for (const ctx of contexts) { await upsertLivePushAlertSettings(ctx, value); completed++; } }
  catch { throw new Error(`Saved ${completed} of ${contexts.length} queues; refresh before changing remaining settings`); }
}
export async function cleanupAdminDeviceTokens(ageDays: number) {
  if (!Number.isInteger(ageDays) || ageDays < 1 || ageDays > 3650) throw new Error("Choose a valid token age");
  const contexts = await adminQueueContexts();
  let count = 0;
  let completed = 0;
  try { for (const ctx of contexts) { count += await cleanupLiveStaleDeviceTokens(ctx, Date.now(), ageDays * 86400000); completed++; } }
  catch { throw new Error(`Removed ${count} registrations from ${completed} of ${contexts.length} queues; remaining cleanup is unconfirmed`); }
  return count;
}