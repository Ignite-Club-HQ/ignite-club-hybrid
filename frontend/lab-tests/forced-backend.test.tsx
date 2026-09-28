import { expect, test } from 'vitest';
import { getForcedBackend, resolveForcedBackend } from '../src/lab/forcedBackend';

test('accepts only the two local forced backend values', () => {
  expect(resolveForcedBackend(undefined)).toBeNull();
  expect(resolveForcedBackend('icp')).toBe('icp');
  expect(resolveForcedBackend('supabase')).toBe('supabase');
  expect(() => resolveForcedBackend('hybrid')).toThrow('IGNITE_LAB_FORCED_BACKEND');
});

test('exposes the build-injected forced backend when the matrix runner selects one', () => {
  const forcedBackend = getForcedBackend();
  expect([null, 'icp', 'supabase']).toContain(forcedBackend);
  if (process.env.IGNITE_LAB_FORCED_BACKEND) {
    expect(forcedBackend).toBe(process.env.IGNITE_LAB_FORCED_BACKEND);
  }
});
