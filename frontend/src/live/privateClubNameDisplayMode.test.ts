import { afterEach, expect, it, vi } from 'vitest';
import { privateClubNameDisplaysEnabled } from './privateClubNameDisplayMode';
import { privateProfileSearchRehearsalEnabled } from './privateProfileSearchMode';
afterEach(() => vi.unstubAllEnvs());
it('club display release does not activate search rehearsal', () => {
  vi.stubEnv('IGNITE_LIVE_PRIVATE_PROFILE_SEARCH_REHEARSAL', '0');
  vi.stubEnv('IGNITE_LIVE_PRIVATE_CLUB_NAME_DISPLAYS', '1');
  expect(privateClubNameDisplaysEnabled()).toBe(true);
  expect(privateProfileSearchRehearsalEnabled()).toBe(false);
});
it('display cutover stays off until explicitly released', () => {
  vi.stubEnv('IGNITE_LIVE_PRIVATE_PROFILE_SEARCH_REHEARSAL', '0');
  vi.stubEnv('IGNITE_LIVE_PRIVATE_CLUB_NAME_DISPLAYS', '0');
  expect(privateClubNameDisplaysEnabled()).toBe(false);
});