import { expect, test } from 'vitest';
import type { _SERVICE } from '../src/lab/bindings/timer_jobs/declarations/timer_jobs.did.js';
import { createTimerJobsClient } from '../src/lab/timerJobsClient';

const job = (id: string) => ({ id, scope: 'club-a', run_at_ms: 10n, idempotency_key: `${id}:key`, status: { Pending: null }, attempts: 0, last_error: [] });
test('converts timer Candid values and preserves optional fields', async () => {
  const actor = {
    schedule: async () => ({ Ok: job('a') }),
    arm: async (at: bigint) => ({ armed: true, next_run_at_ms: [at] }),
    claim: async () => ({ Ok: [job('a')] }),
    complete: async () => ({ Ok: { ...job('a'), status: { Completed: null }, attempts: 1 } }),
    fail: async () => ({ Ok: { ...job('a'), status: { Failed: null }, last_error: ['x'] } }),
    recover_interrupted: async () => 1,
    get_job: async () => [job('a')],
  } as unknown as _SERVICE;
  const client = createTimerJobsClient(actor);
  expect(await client.schedule({ id: 'a', scope: 'club-a', runAtMs: 10, idempotencyKey: 'a:key' })).toMatchObject({ id: 'a', status: 'pending', runAtMs: 10 });
  expect((await client.complete('a', 'a:key')).status).toBe('completed');
  expect((await client.fail('a', 'x')).lastError).toBe('x');
  expect((await client.get('a'))?.id).toBe('a');
});

test('fails closed on canister result errors', async () => {
  const actor = { schedule: async () => ({ Err: 'forbidden' }) } as unknown as _SERVICE;
  await expect(createTimerJobsClient(actor).schedule({ id: 'a', scope: 'club-a', runAtMs: 0, idempotencyKey: 'k' })).rejects.toThrow('forbidden');
});
