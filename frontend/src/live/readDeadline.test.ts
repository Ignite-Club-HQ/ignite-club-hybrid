import { describe, expect, it, vi } from 'vitest';
import { withReadDeadline } from './readDeadline';
describe('bounded read coordination', () => {
  it('releases a stalled read without replaying it', async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(() => new Promise<string>(() => {}));
      const pending = withReadDeadline(read(), 'Routing', 100);
      const rejected = expect(pending).rejects.toThrow('Routing timed out');
      await vi.advanceTimersByTimeAsync(100); await rejected;
      expect(read).toHaveBeenCalledOnce();
      expect(await withReadDeadline(Promise.resolve('event'), 'Event')).toBe('event');
    } finally { vi.useRealTimers(); }
  });
});