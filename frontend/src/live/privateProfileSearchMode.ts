/** Search connections may be exercised on disposable replicas only. This is
 * not a production release flag; approvals/acceptance precede that cutover. */
export function privateProfileSearchRehearsalEnabled(): boolean {
  return import.meta.env.IGNITE_LIVE_PRIVATE_PROFILE_SEARCH_REHEARSAL === "1";
}