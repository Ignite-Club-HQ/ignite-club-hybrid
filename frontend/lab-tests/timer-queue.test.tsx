import { expect, test } from 'vitest';
import { createSyntheticTimerQueue } from '../src/lab/syntheticTimerQueue';

test('claims bounded due work and completes idempotently', () => {
  const queue = createSyntheticTimerQueue();
  queue.schedule({ id: 'job-a', scope: 'club-a', runAtMs: 10, idempotencyKey: 'club-a:cleanup:1' });
  queue.schedule({ id: 'job-b', scope: 'club-a', runAtMs: 10, idempotencyKey: 'club-a:cleanup:2' });
  expect(queue.claim(10, 1)).toHaveLength(1);
  queue.complete('job-a', 'club-a:cleanup:1');
  expect(() => queue.complete('job-a', 'club-a:cleanup:1')).not.toThrow();
  expect(queue.get('job-a')?.status).toBe('completed');
  expect(queue.get('job-b')?.status).toBe('pending');
});

test('retries failed work and recovers processing jobs after interruption', () => {
  const queue = createSyntheticTimerQueue();
  queue.schedule({ id: 'job-a', scope: 'club-a', runAtMs: 0, idempotencyKey: 'k' });
  queue.claim(0, 10);
  queue.fail('job-a', 'temporary', 20);
  expect(queue.claim(10, 10)).toHaveLength(0);
  expect(queue.claim(20, 10)).toHaveLength(1);
  queue.recoverInterrupted();
  expect(queue.claim(20, 10)).toHaveLength(1);
});

test('re-arms the durable schedule after an upgrade', () => {
  const queue = createSyntheticTimerQueue();
  queue.arm(100);
  expect(queue.isArmed()).toBe(true);
  queue.recoverInterrupted();
  queue.rearmAfterUpgrade();
  expect(queue.nextRunAt()).toBe(100);
});
