export function attendanceRsvpKey(rsvp: any): string {
  const linkedChildId = rsvp.child_id ?? rsvp.mini_league_players?.child_id ?? null;
  if (linkedChildId) return `c:${linkedChildId}`;
  if (rsvp.mini_league_player_id) return `m:${rsvp.mini_league_player_id}`;
  return `u:${rsvp.user_id}`;
}

export function shouldDisplayAttendanceRsvp(
  rsvp: any,
  options: { showAll: boolean; miniLeague: boolean; playerUserIds: Set<string> },
): boolean {
  if (options.showAll) return true;
  if (options.miniLeague) return !!rsvp.child_id || !!rsvp.mini_league_player_id;
  return !!rsvp.child_id
    || !!rsvp.mini_league_player_id
    || options.playerUserIds.has(rsvp.user_id);
}

export function prepareAttendanceRsvps(
  rows: any[],
  options: {
    targeted: boolean;
    scopedChildIds: Set<string>;
    scopedAdultIds: Set<string>;
    scopedChildNames: Map<string, string>;
  },
): any[] {
  const seen = new Set<string>();
  const prepared: any[] = [];
  for (const rsvp of rows) {
    const childId = rsvp.child_id ?? rsvp.mini_league_players?.child_id ?? null;
    if (options.targeted) {
      if (childId ? !options.scopedChildIds.has(childId) : rsvp.user_id && !options.scopedAdultIds.has(rsvp.user_id)) {
        continue;
      }
    }
    const key = attendanceRsvpKey(rsvp);
    if (seen.has(key)) continue;
    seen.add(key);
    if (rsvp.child_id && !rsvp.children?.name) {
      const name = options.scopedChildNames.get(rsvp.child_id);
      prepared.push(name ? { ...rsvp, children: { ...(rsvp.children ?? {}), name } } : rsvp);
    } else {
      prepared.push(rsvp);
    }
  }
  return prepared;
}

export function calculateAttendanceNonResponders(input: {
  rsvps: any[];
  miniLeague: boolean;
  showAll: boolean;
  miniLeaguePlayers?: any[] | null;
  miniLeagueAdults?: any[] | null;
  visibleMembers?: any[] | null;
  children?: any[] | null;
  childGuardians?: any[] | null;
  reminderMembers?: any[] | null;
}) {
  const respondedUsers = new Set(input.rsvps.filter((r) => !r.child_id).map((r) => r.user_id));
  const respondedChildren = new Set(input.rsvps.filter((r) => r.child_id).map((r) => r.child_id));
  const respondedLeaguePlayers = new Set(
    input.rsvps.filter((r) => r.mini_league_player_id).map((r) => r.mini_league_player_id),
  );

  if (input.miniLeague) {
    const children = (input.miniLeaguePlayers ?? []).filter((player) =>
      !respondedLeaguePlayers.has(player.id)
      && !(player.child_id && respondedChildren.has(player.child_id)));
    const adults = input.showAll
      ? (input.miniLeagueAdults ?? []).filter((adult) => !respondedUsers.has(adult.id))
      : [];
    return {
      adults,
      children,
      reminderAdults: (input.miniLeagueAdults ?? []).filter((adult) => !respondedUsers.has(adult.id)),
    };
  }

  const parentsWithRespondedChildren = new Set<string>();
  for (const child of input.children ?? []) {
    if (child.parent_id && respondedChildren.has(child.id)) parentsWithRespondedChildren.add(child.parent_id);
  }
  for (const link of input.childGuardians ?? []) {
    if (link.guardian_id && respondedChildren.has(link.child_id)) parentsWithRespondedChildren.add(link.guardian_id);
  }
  const hasNotResponded = (member: any) =>
    !respondedUsers.has(member.id) && !parentsWithRespondedChildren.has(member.id);
  return {
    adults: (input.visibleMembers ?? []).filter(hasNotResponded),
    children: (input.children ?? []).filter((child) => !respondedChildren.has(child.id)),
    reminderAdults: (input.reminderMembers ?? []).filter(hasNotResponded),
  };
}
