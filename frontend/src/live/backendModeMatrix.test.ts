import { describe, expect, it } from 'vitest';
import { FEATURE_AREAS } from './featureBackend';
import { getEffectiveBackendForFeature } from './loadBackendRouting';

describe('configured test backend mode', () => {
  it('routes every configured feature through the selected backend', () => {
    const expectedBackend = process.env.IGNITE_TEST_BACKEND_MODE === 'icp' ? 'icp' : 'supabase';

    for (const feature of FEATURE_AREAS) {
      expect(getEffectiveBackendForFeature(feature), feature).toBe(expectedBackend);
    }
  });
});