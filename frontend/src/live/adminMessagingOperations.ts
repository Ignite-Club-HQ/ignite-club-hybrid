import { withFeatureBackend, type FeatureBackendContext } from "./featureRouter";
import { getLiveChatPhotoReminderSettings, setLiveChatPhotoReminderSettings, runLiveChatPhotoGalleryReminders } from "./features/messaging";
type Policy = Parameters<typeof setLiveChatPhotoReminderSettings>[1];
const unavailable = async (): Promise<never> => { throw new Error("Internet Identity connection required"); };
export async function adminMessagingContexts() {
  return withFeatureBackend<FeatureBackendContext[]>("messaging", { supabase: unavailable, icp: async ctx => [ctx] }, {
    everyGroup: true, requireComplete: true,
    merge: parts => [...new Map((parts as FeatureBackendContext[][]).flat().map(ctx => {
      const id = ctx.target.canisterIds.messaging_domain;
      if (!id) throw new Error("Messaging service is missing from the inventory");
      return [JSON.stringify([ctx.target.host, ctx.target.networkKind, id]), ctx] as const;
    })).values()],
  });
}
export async function readAdminPhotoReminderSettings() {
  const contexts = await adminMessagingContexts();
  return Promise.all(contexts.map(async ctx => ({ service: ctx.target.canisterIds.messaging_domain, policy: await Promise.race([getLiveChatPhotoReminderSettings(ctx), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("A messaging service took too long to answer")), 15_000))]) })));
}
export async function saveAdminPhotoReminderSettings(policy: Policy) {
  const contexts = await adminMessagingContexts(); let completed = 0;
  try { for (const ctx of contexts) { await setLiveChatPhotoReminderSettings(ctx, { ...policy }); completed++; } }
  catch { throw new Error(`Saved ${completed} of ${contexts.length} services; the attempted save is unconfirmed. Refresh before further changes.`); }
  const readback = await Promise.all(contexts.map(ctx => getLiveChatPhotoReminderSettings(ctx)));
  if (readback.some(row => Object.keys(policy).some(key => row[key as keyof Policy] !== policy[key as keyof Policy]))) throw new Error("Saved policies differ on readback; refresh before further changes.");
  return completed;
}
export async function runAdminPhotoReminders(policy: Policy) {
  const contexts = await adminMessagingContexts(); let completed = 0;
  const totals = { scanned: 0, posted: 0, skipped: 0 };
  try { for (const ctx of contexts) {
    const result = await runLiveChatPhotoGalleryReminders(ctx, Date.now(), policy.window_start_hours, policy.window_end_hours, policy.cooldown_days);
    totals.scanned += result.scanned; totals.posted += result.posted; totals.skipped += result.skipped; completed++;
  } } catch { throw new Error(`Queued ${totals.posted} reminders on ${completed} of ${contexts.length} services; the attempted run is unconfirmed and must not be replayed.`); }
  return totals;
}