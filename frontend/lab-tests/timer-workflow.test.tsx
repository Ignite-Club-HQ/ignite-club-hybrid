import { expect, test } from 'vitest';
import { createSyntheticTimerQueue } from '../src/lab/syntheticTimerQueue';
import { runClubLinkMaintenance, scheduleClubLinkMaintenance } from '../src/lab/syntheticTimerWorkflow';

test('runs club-link maintenance through the durable queue with bounded work', () => {
  const queue = createSyntheticTimerQueue();
  scheduleClubLinkMaintenance(queue, 'club-a', 100);
  scheduleClubLinkMaintenance(queue, 'club-b', 100);
  const seen: string[] = [];
  const result = runClubLinkMaintenance(queue, 100, 1, job => seen.push(job.scope));
  expect(result).toEqual({ claimed: ['club-links:club-a:100'], completed: ['club-links:club-a:100'], retried: [] });
  expect(seen).toEqual(['club-a']);
  expect(queue.get('club-links:club-b:100')?.status).toBe('pending');
});

test('keeps failed maintenance durable and retries it later', () => {
  const queue = createSyntheticTimerQueue();
  scheduleClubLinkMaintenance(queue, 'club-a', 0);
  const first = runClubLinkMaintenance(queue, 0, 10, () => { throw new Error('temporary'); }, 50);
  expect(first.retried).toEqual(['club-links:club-a:0']);
  expect(queue.claim(49, 10)).toHaveLength(0);
  const second = runClubLinkMaintenance(queue, 50, 10, () => undefined);
  expect(second.completed).toEqual(['club-links:club-a:0']);
  expect(queue.get('club-links:club-a:0')?.attempts).toBe(2);
});
