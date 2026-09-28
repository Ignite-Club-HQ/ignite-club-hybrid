export type TimerJob = {
  id: string;
  scope: string;
  runAtMs: number;
  idempotencyKey: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  lastError?: string;
};

export function createSyntheticTimerQueue() {
  const jobs = new Map<string, TimerJob>();
  let armed = false;
  let nextArmAtMs: number | undefined;
  return {
    schedule(job: Omit<TimerJob, 'status' | 'attempts'>) {
      if (jobs.has(job.id)) return jobs.get(job.id)!;
      const value: TimerJob = { ...job, status: 'pending', attempts: 0 };
      jobs.set(job.id, value); return value;
    },
    arm(nextRunAtMs: number) { armed = true; nextArmAtMs = nextRunAtMs; },
    rearmAfterUpgrade() { if (nextArmAtMs !== undefined) armed = true; },
    isArmed() { return armed; },
    nextRunAt() { return nextArmAtMs; },
    claim(nowMs: number, limit: number) {
      if (limit <= 0) throw new Error('Invalid batch size');
      const claimed = [...jobs.values()].filter(job => job.status === 'pending' && job.runAtMs <= nowMs).slice(0, limit);
      for (const job of claimed) { job.status = 'processing'; job.attempts += 1; }
      return claimed;
    },
    complete(id: string, idempotencyKey: string) {
      const job = jobs.get(id);
      if (!job || job.idempotencyKey !== idempotencyKey) throw new Error('Unknown timer job');
      if (job.status === 'completed') return job;
      if (job.status !== 'processing') throw new Error('Job is not processing');
      job.status = 'completed'; return job;
    },
    fail(id: string, error: string, retryAtMs?: number) {
      const job = jobs.get(id);
      if (!job || job.status !== 'processing') throw new Error('Job is not processing');
      job.lastError = error; job.status = retryAtMs === undefined ? 'failed' : 'pending';
      if (retryAtMs !== undefined) job.runAtMs = retryAtMs;
      return job;
    },
    recoverInterrupted() {
      for (const job of jobs.values()) if (job.status === 'processing') job.status = 'pending';
    },
    get(id: string) { return jobs.get(id); },
  };
}
