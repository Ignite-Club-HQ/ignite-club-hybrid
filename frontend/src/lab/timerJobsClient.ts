import type { TimerJob } from './syntheticTimerQueue';
import type { _SERVICE, job, status } from './bindings/timer_jobs/declarations/timer_jobs.did.js';

export type TimerJobsClient = ReturnType<typeof createTimerJobsClient>;
const unwrap = <T>(result: { Ok: T } | { Err: string }): T => {
  if ('Err' in result) throw new Error(result.Err);
  return result.Ok;
};
const convertStatus = (value: status): TimerJob['status'] => {
  if ('Processing' in value) return 'processing';
  if ('Completed' in value) return 'completed';
  if ('Failed' in value) return 'failed';
  return 'pending';
};
const convert = (value: job): TimerJob => ({
  id: value.id,
  scope: value.scope,
  runAtMs: Number(value.run_at_ms),
  idempotencyKey: value.idempotency_key,
  status: convertStatus(value.status),
  attempts: value.attempts,
  ...(value.last_error[0] === undefined ? {} : { lastError: value.last_error[0] }),
});

/** Provider-neutral timer queue adapter. It has no default endpoint or fallback. */
export function createTimerJobsClient(actor: _SERVICE) {
  return {
    async schedule(job: Pick<TimerJob, 'id' | 'scope' | 'runAtMs' | 'idempotencyKey'>) {
      return convert(unwrap(await actor.schedule(job.id, job.scope, BigInt(job.runAtMs), job.idempotencyKey)));
    },
    arm(nextRunAtMs: number) { return actor.arm(BigInt(nextRunAtMs)); },
    async claim(nowMs: number, limit: number) { return unwrap(await actor.claim(BigInt(nowMs), limit)).map(convert); },
    async complete(id: string, idempotencyKey: string) { return convert(unwrap(await actor.complete(id, idempotencyKey))); },
    async fail(id: string, error: string, retryAtMs?: number) {
      return convert(unwrap(await actor.fail(id, error, retryAtMs === undefined ? [] : [BigInt(retryAtMs)])));
    },
    recoverInterrupted() { return actor.recover_interrupted(); },
    async get(id: string) { const value = await actor.get_job(id); return value[0] ? convert(value[0]) : undefined; },
  };
}
