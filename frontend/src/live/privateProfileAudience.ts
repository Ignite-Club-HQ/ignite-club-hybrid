import type { Principal } from '@icp-sdk/core/principal';

/** Untrusted selectors: owning services verify every subject. Never a grant. */
export type PrivateProfileAudience = {
  kind: 'club' | 'family' | 'competition' | 'league' | 'guardian_search' | 'direct' | 'broadcast' | 'competition_admin';
  authority: Principal;
  resource: string;
  profile_revision: bigint;
};