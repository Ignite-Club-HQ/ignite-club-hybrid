import { expect, it, vi } from 'vitest';
import { retryScheduleRefresh } from './retryScheduleRefresh';
it('waits for memberships to settle before refreshing the current event scope', async () => {
  let finish: (() => void) | undefined;
  const memberships = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const events = vi.fn(async () => undefined);
  const pending = retryScheduleRefresh(memberships, events);
  expect(events).not.toHaveBeenCalled();
  finish?.();
  await pending;
  expect(events).toHaveBeenCalledTimes(1);
});