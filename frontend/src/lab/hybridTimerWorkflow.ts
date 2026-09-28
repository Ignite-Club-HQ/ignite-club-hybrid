import type { TimerJob } from './syntheticTimerQueue';
import type { createHybridTimerDispatcher } from './hybridTimerDispatcher';

type Dispatcher = ReturnType<typeof createHybridTimerDispatcher>;

export function scheduleHybridClubLinkMaintenance(dispatcher: Dispatcher, clubId: string, runAtMs: number) {
  return dispatcher.schedule({ id: `club-links:${clubId}:${runAtMs}`, scope: clubId, runAtMs, idempotencyKey: `${clubId}:club-links-maintenance:${runAtMs}` });
}

export async function processHybridClubLinkMaintenance(
  dispatcher: Dispatcher,
  clubId: string,
  nowMs: number,
  limit: number,
  perform: (job: TimerJob) => Promise<void> | void,
  retryAtMs = nowMs + 60_000,
) {
  const claimed = await dispatcher.claim(clubId, nowMs, limit);
  const completed: string[] = []; const retried: string[] = [];
  for (const job of claimed) {
    try { await perform(job); await dispatcher.complete(clubId, job.id, job.idempotencyKey); completed.push(job.id); }
    catch (error) { await dispatcher.fail(clubId, job.id, error instanceof Error ? error.message : 'maintenance failed', retryAtMs); retried.push(job.id); }
  }
  return { claimed: claimed.map(job => job.id), completed, retried };
}
