import { QueryClient } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ results: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/live/features/messaging', () => ({ getLivePollResults: mocks.results }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: mocks.dispatch }));
import { pollQueryOptions, prefetchMessagePolls } from './pollReadRepository';
describe('team and club poll early loading', () => {
  for (const scope of [{ teamId: 'u9' }, { clubId: 'goat' }]) {
    it(`shares the early authorized read with a card in ${JSON.stringify(scope)}`, async () => {
      vi.clearAllMocks();
      const ctx = { target: 'owning-group' } as never;
      mocks.results.mockResolvedValue({ poll: { id: 'poll', question: 'Play?', options: ['Yes'], creator: { toText: () => 'coach' }, created_at_ms: 1000n, closed: false }, counts: [1] });
      const client = new QueryClient();
      prefetchMessagePolls(client, [{ body: '[poll:poll] [poll:poll]' }], 'paul', scope, true, ctx);
      const data = await client.ensureQueryData(pollQueryOptions('poll', 'paul', scope, true));
      expect(data?.poll.question).toBe('Play?');
      expect(mocks.results).toHaveBeenCalledTimes(1);
      expect(mocks.results).toHaveBeenCalledWith(ctx, 'poll');
      expect(mocks.dispatch).not.toHaveBeenCalled();
      expect(client.getQueryData(pollQueryOptions('poll', 'other', scope, true).queryKey)).toBeUndefined();
      client.clear();
    });
  }
});