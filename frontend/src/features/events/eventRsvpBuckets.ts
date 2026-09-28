export interface EventRsvp {
  status: string;
  user_id?: string | null;
  child_id?: string | null;
  mini_league_player_id?: string | null;
  mini_league_players?: { child_id?: string | null } | null;
  children?: { name?: string | null; [key: string]: unknown } | null;
}

interface EventRsvpBucketOptions {
  rsvps: readonly EventRsvp[] | null | undefined;
  effectiveShowAll: boolean;
  isMiniLeagueEvent: boolean;
  adultsAreTheAudience: boolean;
  playerUserIds: ReadonlySet<string>;
  isTargetedScope: boolean;
  scopedChildIds: ReadonlySet<string>;
  scopedAdultIds: ReadonlySet<string>;
  scopedChildNames: ReadonlyMap<string, string>;
}

export interface EventRsvpBuckets {
  goingRsvps: EventRsvp[];
  maybeRsvps: EventRsvp[];
  notGoingRsvps: EventRsvp[];
}

function visibleInDefaultAudience(
  rsvp: EventRsvp,
  {
    effectiveShowAll,
    isMiniLeagueEvent,
    adultsAreTheAudience,
    playerUserIds,
  }: Pick<
    EventRsvpBucketOptions,
    "effectiveShowAll" | "isMiniLeagueEvent" | "adultsAreTheAudience" | "playerUserIds"
  >,
): boolean {
  if (effectiveShowAll) return true;
  if (isMiniLeagueEvent) {
    return Boolean(rsvp.child_id || rsvp.mini_league_player_id);
  }
  if (rsvp.mini_league_player_id || rsvp.child_id || adultsAreTheAudience) return true;
  return rsvp.user_id ? playerUserIds.has(rsvp.user_id) : false;
}

function identityKey(rsvp: EventRsvp): string {
  const linkedChildId = rsvp.child_id || rsvp.mini_league_players?.child_id || null;
  if (linkedChildId) return `c:${linkedChildId}`;
  if (rsvp.mini_league_player_id) return `m:${rsvp.mini_league_player_id}`;
  return `u:${rsvp.user_id}`;
}

function isInTargetScope(
  rsvp: EventRsvp,
  {
    isTargetedScope,
    scopedChildIds,
    scopedAdultIds,
  }: Pick<EventRsvpBucketOptions, "isTargetedScope" | "scopedChildIds" | "scopedAdultIds">,
): boolean {
  if (!isTargetedScope) return true;
  const childId = rsvp.child_id || rsvp.mini_league_players?.child_id || null;
  if (childId) return scopedChildIds.has(childId);
  return !rsvp.user_id || scopedAdultIds.has(rsvp.user_id);
}

function hydrateChildName(
  rsvp: EventRsvp,
  scopedChildNames: ReadonlyMap<string, string>,
): EventRsvp {
  if (!rsvp.child_id || rsvp.children?.name) return rsvp;
  const name = scopedChildNames.get(rsvp.child_id);
  return name ? { ...rsvp, children: { ...rsvp.children, name } } : rsvp;
}

function prepareRsvps(
  rsvps: readonly EventRsvp[],
  options: EventRsvpBucketOptions,
): EventRsvp[] {
  const seen = new Set<string>();

  return rsvps
    .filter((rsvp) => isInTargetScope(rsvp, options))
    .filter((rsvp) => {
      const key = identityKey(rsvp);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((rsvp) => hydrateChildName(rsvp, options.scopedChildNames));
}

/**
 * Produces the RSVP status buckets after the page has resolved its audience
 * membership. Data access and role resolution deliberately remain page-owned.
 */
export function buildEventRsvpBuckets(options: EventRsvpBucketOptions): EventRsvpBuckets {
  const rsvps = options.rsvps ?? [];
  const byStatus = (status: EventRsvp["status"]) =>
    prepareRsvps(
      rsvps.filter(
        (rsvp) =>
          rsvp.status === status &&
          visibleInDefaultAudience(rsvp, options),
      ),
      options,
    );

  return {
    goingRsvps: byStatus("going"),
    maybeRsvps: byStatus("maybe"),
    notGoingRsvps: byStatus("not_going"),
  };
}
