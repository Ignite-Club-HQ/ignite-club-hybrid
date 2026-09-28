import { expect, test, vi } from 'vitest';
import { executeHybridQuery, hybridQueryKey } from '../src/lab/useHybridQuery';

test('isolates hybrid query keys by backend and identity', () => {
  expect(hybridQueryKey(['clubs'], 'icp', 'member-1')).not.toEqual(
    hybridQueryKey(['clubs'], 'supabase', 'member-1'),
  );
  expect(hybridQueryKey(['clubs'], 'icp', 'member-1')).not.toEqual(
    hybridQueryKey(['clubs'], 'icp', 'member-2'),
  );
  expect(hybridQueryKey(['clubs'], 'icp', 'member-1')).toEqual([
    'clubs',
    { backend: 'icp', userId: 'member-1' },
  ]);
});

test('uses ICP fixture data without invoking Supabase', async () => {
  const supabaseQuery = vi.fn();
  const fixtureQuery = vi.fn(() => ({ id: 'club-icp-001' }));

  await expect(executeHybridQuery(
    'icp',
    'member-1',
    supabaseQuery,
    fixtureQuery,
  )).resolves.toEqual({ id: 'club-icp-001' });

  expect(fixtureQuery).toHaveBeenCalledWith('member-1');
  expect(supabaseQuery).not.toHaveBeenCalled();
});

test('surfaces ICP fixture failures instead of returning a success-shaped null', async () => {
  const fixtureError = new Error('fixture unavailable');

  await expect(executeHybridQuery(
    'icp',
    'member-1',
    vi.fn(),
    () => { throw fixtureError; },
  )).rejects.toBe(fixtureError);
});

test('uses Supabase only when explicitly routed to Supabase', async () => {
  const supabaseQuery = vi.fn(async () => ({ data: { id: 'club-supabase-001' }, error: null }));
  const fixtureQuery = vi.fn(() => ({ id: 'club-icp-001' }));

  await expect(executeHybridQuery(
    'supabase',
    'member-1',
    supabaseQuery,
    fixtureQuery,
  )).resolves.toEqual({ id: 'club-supabase-001' });

  expect(supabaseQuery).toHaveBeenCalledTimes(1);
  expect(fixtureQuery).not.toHaveBeenCalled();
});
