/**
 * Synthetic, in-memory reconstruction of the `event_groups` /
 * `event_group_players` authorization + invariant subsystem exercised by
 * the exported `event-groups-rls.test.ts` suite (22 cases).
 *
 * Unlike `role-surface-access-matrix.test.ts` (see
 * `roleSurfaceAccessModel.ts`), every function this file's assertions
 * actually depend on has a complete, self-contained `CREATE FUNCTION`
 * definition in the exported migration corpus - no `has_role` dependency
 * or evidence gap applies here:
 *  - `can_manage_event_groups(_user_id, _event_id)`:
 *    `20260730073705_81d9921e-d827-4fde-9a85-d5dfda1ee506.sql.md`.
 *  - `event_group_player_scope_ok(_group_id, _player_id)`: same file.
 *  - `move_event_group_player` / `swap_event_group_players` /
 *    `replace_event_groups`:
 *    `20260730074102_39bd1d83-2fc8-4239-a904-c3b754385cea.sql.md`.
 *  - The `event_group_players` `UNIQUE(event_id, player_id)` invariant
 *    (one match per player per event, enforced by both a real constraint
 *    and a defense-in-depth trigger raising Postgres error code `23505`):
 *    `20260730213558_3b87a835-4702-46e2-866f-bf6e1aa83613.sql.md`.
 *  - `is_club_member(_user_id, _club_id)`:
 *    `20260504115905_edc383be-68a9-4380-b0f6-147f0099a99d.sql.md`.
 *
 * `move_event_group_player` and `swap_event_group_players` are plain
 * `LANGUAGE plpgsql` functions with no `SECURITY DEFINER` - per the
 * source's own comment ("Invoker rights: every statement is still
 * subject to Event Groups RLS"), every UPDATE/INSERT they issue is
 * re-checked against the same RLS policies modeled here, which is why a
 * non-privileged caller's move/swap/replace attempt fails exactly like a
 * direct table mutation would.
 */

export type MatrixRole =
  | 'club_admin'
  | 'committee_member'
  | 'team_admin'
  | 'coach'
  | 'player'
  | 'parent'
  | 'league_admin'
  | 'app_admin';

export interface UserRoleRow {
  userId: string;
  role: MatrixRole;
  clubId: string | null;
  teamId: string | null;
}

export interface TeamRow {
  id: string;
  clubId: string;
}

export interface EventRow {
  id: string;
  clubId: string;
  miniLeagueId: string | null;
}

export interface MiniLeagueRow {
  id: string;
  clubId: string;
}

export interface MiniLeaguePlayerRow {
  id: string;
  miniLeagueId: string;
  parentUserId?: string;
}

export interface EventGroupRow {
  id: string;
  eventId: string;
  name: string;
  pitchName?: string;
  displayOrder?: number;
}

export interface EventGroupPlayerRow {
  id: string;
  groupId: string;
  eventId: string;
  playerId: string;
  team: 'a' | 'b' | null;
}

export interface ReplaceGroupPlayerInput {
  playerId: string;
  team?: 'a' | 'b' | string | null;
}

export interface ReplaceGroupInput {
  name?: string;
  pitchName?: string;
  displayOrder?: number;
  players?: ReplaceGroupPlayerInput[];
}

export class RlsError extends Error {}

/** `is_club_member(_user_id, _club_id)`: direct role, via a team, or as parent/guardian of an assigned child. */
export function isClubMember(roles: UserRoleRow[], teams: TeamRow[], userId: string, clubId: string): boolean {
  const direct = roles.some((r) => r.userId === userId && r.clubId === clubId);
  const viaTeam = roles.some((r) => {
    if (r.userId !== userId || r.teamId === null) return false;
    const team = teams.find((t) => t.id === r.teamId);
    return team !== undefined && team.clubId === clubId;
  });
  return direct || viaTeam;
}

/** `can_manage_event_groups(_user_id, _event_id)`. */
export function canManageEventGroups(
  roles: UserRoleRow[],
  events: EventRow[],
  userId: string,
  eventId: string,
): boolean {
  const event = events.find((e) => e.id === eventId);
  if (!event) return false;
  const isAppAdmin = roles.some((r) => r.userId === userId && r.role === 'app_admin');
  if (isAppAdmin) return true;
  return roles.some((r) => {
    if (r.userId !== userId || r.clubId !== event.clubId) return false;
    if (r.role === 'club_admin' || r.role === 'committee_member' || r.role === 'league_admin') return true;
    return r.role === 'coach' && r.teamId === null && event.miniLeagueId !== null;
  });
}

/** `event_group_player_scope_ok(_group_id, _player_id)`. */
export function eventGroupPlayerScopeOk(
  groups: EventGroupRow[],
  events: EventRow[],
  miniLeaguePlayers: MiniLeaguePlayerRow[],
  miniLeagues: MiniLeagueRow[],
  groupId: string,
  playerId: string,
): boolean {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return false;
  const event = events.find((e) => e.id === group.eventId);
  const player = miniLeaguePlayers.find((p) => p.id === playerId);
  if (!event || !player) return false;
  const league = miniLeagues.find((l) => l.id === player.miniLeagueId);
  if (!league) return false;
  if (event.miniLeagueId !== null) return player.miniLeagueId === event.miniLeagueId;
  return league.clubId === event.clubId;
}

/** `is_club_member(...) OR mini_league_players.parent_user_id = uid` for `event_groups`/`event_group_players` SELECT. */
export function canReadEventGroups(
  roles: UserRoleRow[],
  teams: TeamRow[],
  miniLeaguePlayers: MiniLeaguePlayerRow[],
  events: EventRow[],
  userId: string,
  eventId: string,
): boolean {
  const event = events.find((e) => e.id === eventId);
  if (!event) return false;
  if (isClubMember(roles, teams, userId, event.clubId)) return true;
  return miniLeaguePlayers.some((p) => p.miniLeagueId === event.miniLeagueId && p.parentUserId === userId);
}

interface Snapshot {
  groups: EventGroupRow[];
  assignments: EventGroupPlayerRow[];
}

export class SyntheticEventGroupsDb {
  roles: UserRoleRow[] = [];
  teams: TeamRow[] = [];
  events: EventRow[] = [];
  miniLeagues: MiniLeagueRow[] = [];
  miniLeaguePlayers: MiniLeaguePlayerRow[] = [];
  groups: EventGroupRow[] = [];
  assignments: EventGroupPlayerRow[] = [];
  private nextId = 1;

  private id(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  private snapshot(): Snapshot {
    // Deep-clone every row: `updateAssignmentInPlace` mutates row objects in
    // place, so a shallow array copy would still share mutated references.
    return {
      groups: this.groups.map((g) => ({ ...g })),
      assignments: this.assignments.map((a) => ({ ...a })),
    };
  }

  private restore(snap: Snapshot): void {
    this.groups = snap.groups;
    this.assignments = snap.assignments;
  }

  canManage(userId: string, eventId: string): boolean {
    return canManageEventGroups(this.roles, this.events, userId, eventId);
  }

  scopeOk(groupId: string, playerId: string): boolean {
    return eventGroupPlayerScopeOk(this.groups, this.events, this.miniLeaguePlayers, this.miniLeagues, groupId, playerId);
  }

  canRead(userId: string, eventId: string): boolean {
    return canReadEventGroups(this.roles, this.teams, this.miniLeaguePlayers, this.events, userId, eventId);
  }

  /** `event_groups` INSERT ("Managers can insert event groups"). */
  insertGroup(userId: string, eventId: string, name: string, extra: Partial<EventGroupRow> = {}): EventGroupRow {
    if (!this.canManage(userId, eventId)) throw new RlsError('new row violates row-level security policy for "event_groups"');
    const group: EventGroupRow = { id: this.id('group'), eventId, name, ...extra };
    this.groups.push(group);
    return group;
  }

  /** `event_groups` UPDATE ("Managers can update event groups"). Returns updated rows (empty array if RLS filters the target - matches PostgREST's `.update().select()` semantics of an empty affected-rows result rather than an error). */
  updateGroup(userId: string, groupId: string, patch: Partial<EventGroupRow>): EventGroupRow[] {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group || !this.canManage(userId, group.eventId)) return [];
    Object.assign(group, patch);
    return [group];
  }

  /** `event_groups` DELETE ("Managers can delete event groups"), cascading `event_group_players`. */
  deleteGroup(userId: string, groupId: string): EventGroupRow[] {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group || !this.canManage(userId, group.eventId)) return [];
    this.groups = this.groups.filter((g) => g.id !== groupId);
    this.assignments = this.assignments.filter((a) => a.groupId !== groupId);
    return [group];
  }

  /** `event_group_players` INSERT, including the `UNIQUE(event_id, player_id)` trigger invariant. */
  insertAssignment(userId: string, groupId: string, playerId: string, team: 'a' | 'b' | null): EventGroupPlayerRow {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group || !this.canManage(userId, group.eventId)) {
      throw new RlsError('new row violates row-level security policy for "event_group_players"');
    }
    if (!this.scopeOk(groupId, playerId)) {
      throw new RlsError('new row violates row-level security policy for "event_group_players"');
    }
    if (this.assignments.some((a) => a.eventId === group.eventId && a.playerId === playerId)) {
      const err = new RlsError('Player is already assigned to another match in this event');
      (err as Error & { code?: string }).code = '23505';
      throw err;
    }
    const row: EventGroupPlayerRow = { id: this.id('assign'), groupId, eventId: group.eventId, playerId, team };
    this.assignments.push(row);
    return row;
  }

  /** `move_event_group_player(p_player_id, p_from_group_id, p_to_group_id, p_to_team)`. */
  moveEventGroupPlayer(userId: string, playerId: string, fromGroupId: string, toGroupId: string, toTeam: string): void {
    if (toTeam === null || (toTeam !== 'a' && toTeam !== 'b')) {
      throw new RlsError(`Invalid team value: ${toTeam}`);
    }
    const fromGroup = this.groups.find((g) => g.id === fromGroupId);
    const visible = fromGroup !== undefined && this.canManage(userId, fromGroup.eventId);
    const assignment = visible
      ? this.assignments.find((a) => a.groupId === fromGroupId && a.playerId === playerId)
      : undefined;
    if (!assignment) throw new RlsError('Player not found in source group');
    const toGroup = this.groups.find((g) => g.id === toGroupId);
    if (!toGroup || !this.canManage(userId, toGroup.eventId) || !this.scopeOk(toGroupId, playerId)) {
      throw new RlsError('new row violates row-level security policy for "event_group_players"');
    }
    assignment.groupId = toGroupId;
    assignment.eventId = toGroup.eventId;
    assignment.team = toTeam as 'a' | 'b';
  }

  /** `swap_event_group_players(...)`: two sequential in-place moves, rolled back together on any failure. */
  swapEventGroupPlayers(
    userId: string,
    player1Id: string,
    player1GroupId: string,
    player1Team: string | null,
    player2Id: string,
    player2GroupId: string,
    player2Team: string | null,
  ): void {
    for (const team of [player1Team, player2Team]) {
      if (team !== null && team !== 'a' && team !== 'b') throw new RlsError(`Invalid team value: ${team}`);
    }
    if (player1Id === player2Id) throw new RlsError('Cannot swap a player with themselves');
    const snap = this.snapshot();
    try {
      this.updateAssignmentInPlace(userId, player1GroupId, player1Id, player2GroupId, player2Team);
      this.updateAssignmentInPlace(userId, player2GroupId, player2Id, player1GroupId, player1Team);
    } catch (error) {
      this.restore(snap);
      throw error;
    }
  }

  private updateAssignmentInPlace(
    userId: string,
    fromGroupId: string,
    playerId: string,
    toGroupId: string,
    toTeam: string | null,
  ): void {
    const fromGroup = this.groups.find((g) => g.id === fromGroupId);
    const visible = fromGroup !== undefined && this.canManage(userId, fromGroup.eventId);
    const assignment = visible ? this.assignments.find((a) => a.groupId === fromGroupId && a.playerId === playerId) : undefined;
    if (!assignment) throw new RlsError('Player not found in group');
    const toGroup = this.groups.find((g) => g.id === toGroupId);
    if (!toGroup || !this.canManage(userId, toGroup.eventId) || !this.scopeOk(toGroupId, playerId)) {
      throw new RlsError('new row violates row-level security policy for "event_group_players"');
    }
    assignment.groupId = toGroupId;
    assignment.eventId = toGroup.eventId;
    assignment.team = (toTeam as 'a' | 'b' | null) ?? null;
  }

  /** `replace_event_groups(p_event_id, p_groups, p_delete_existing)`, atomic. */
  replaceEventGroups(
    userId: string,
    eventId: string,
    groupsPayload: unknown,
    deleteExisting: boolean,
  ): string[] {
    if (!Array.isArray(groupsPayload)) throw new RlsError('groups payload must be a JSON array');
    const snap = this.snapshot();
    try {
      if (deleteExisting) {
        this.groups = this.groups.filter((g) => !(g.eventId === eventId && this.canManage(userId, eventId)));
        this.assignments = this.assignments.filter((a) => this.groups.some((g) => g.id === a.groupId));
      }
      const ids: string[] = [];
      for (const raw of groupsPayload as ReplaceGroupInput[]) {
        const group = this.insertGroup(userId, eventId, raw.name ?? 'Match', {
          pitchName: raw.pitchName,
          displayOrder: raw.displayOrder,
        });
        ids.push(group.id);
        for (const player of raw.players ?? []) {
          const team = player.team ?? null;
          if (team !== null && team !== 'a' && team !== 'b') throw new RlsError(`Invalid team value: ${String(team)}`);
          this.insertAssignment(userId, group.id, player.playerId, team as 'a' | 'b' | null);
        }
      }
      return ids;
    } catch (error) {
      this.restore(snap);
      throw error;
    }
  }
}
