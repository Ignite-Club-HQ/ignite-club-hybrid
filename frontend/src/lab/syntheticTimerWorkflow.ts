import type { TimerJob } from './syntheticTimerQueue';
import { createSyntheticTimerQueue } from './syntheticTimerQueue';

type TimerQueue = ReturnType<typeof createSyntheticTimerQueue>;

/** Synthetic low-risk workflow seam; it performs no network or provider calls. */
export function scheduleClubLinkMaintenance(queue: TimerQueue, clubId: string, runAtMs: number) {
  return queue.schedule({
    id: `club-links:${clubId}:${runAtMs}`,
    scope: clubId,
    runAtMs,
    idempotencyKey: `${clubId}:club-links-maintenance:${runAtMs}`,
  });
}

export function runClubLinkMaintenance(
  queue: TimerQueue,
  nowMs: number,
  limit: number,
  perform: (job: TimerJob) => void,
  retryAtMs = nowMs + 60_000,
) {
  const claimed = queue.claim(nowMs, limit);
  const completed: string[] = [];
  const retried: string[] = [];
  for (const job of claimed) {
    try {
      perform(job);
      queue.complete(job.id, job.idempotencyKey);
      completed.push(job.id);
    } catch (error) {
      queue.fail(job.id, error instanceof Error ? error.message : 'maintenance failed', retryAtMs);
      retried.push(job.id);
    }
  }
  return { claimed: claimed.map(job => job.id), completed, retried };
}
