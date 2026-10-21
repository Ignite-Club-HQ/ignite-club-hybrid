/** Browser copy of deploy/groups/tested-limits.json — the operator's
 * conservative planning limits per group (NOT load-tested; ~50% of estimated
 * usable memory so capacity triggers fire early). When the operator file
 * changes, update this copy in the same commit. Groups without an entry show
 * raw memory with no utilization bar. */
export const GROUP_TESTED_LIMITS: Record<string, Record<string, number>> = {
  g1: {
    media_blob_store: 8_000_000_000,
    messaging_domain: 1_000_000_000,
    media_metadata: 1_000_000_000,
    notification_queue: 1_000_000_000,
    events_domain: 1_000_000_000,
    insights_domain: 1_000_000_000,
    identity_access: 1_000_000_000,
    club_domain: 1_000_000_000,
    vault_domain: 1_000_000_000,
    pii_access_control: 1_000_000_000,
    club_points_domain: 500_000_000,
    competition_domain: 500_000_000,
    mini_league_domain: 500_000_000,
    timer_jobs: 500_000_000,
  },
};
