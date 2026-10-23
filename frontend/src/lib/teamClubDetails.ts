/** Start independent club reads together without changing their failure semantics. */
export function loadTeamClubDetails<P, S, G>(reads: {
  profile: () => Promise<P>;
  subscription: () => Promise<S>;
  settings: () => Promise<G>;
}): Promise<[P, S, G]> {
  return Promise.all([reads.profile(), reads.subscription(), reads.settings()]);
}