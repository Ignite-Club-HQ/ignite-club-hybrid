import { privateProfileSearchRehearsalEnabled } from './privateProfileSearchMode';

/** Display-only cutover; this is not authorization or a search release.
 * Identity/PII/owning club still independently check the exact audience. */
export function privateClubNameDisplaysEnabled(): boolean {
  return privateProfileSearchRehearsalEnabled() || import.meta.env.IGNITE_LIVE_PRIVATE_CLUB_NAME_DISPLAYS === '1';
}