/**
 * Local port of the sanitized shared module
 * `reference/backend/supabase/functions/process-event-notifications/recipients.ts.md`.
 *
 * Recipient resolution for event fan-out. Behaviour is a safety-critical
 * contract:
 *
 *  - every recipient-producing query is paginated deterministically, so no
 *    audience is silently truncated by the PostgREST per-request row cap;
 *  - every recipient-source read error aborts resolution (fail closed) rather
 *    than degrading into an empty or partial audience.
 */

/**
 * Thrown when any authoritative recipient-source lookup fails. Callers MUST
 * abort the fan-out: an empty recipient list is a valid success result, so
 * failures need a distinguishable signal.
 */
export class AudienceResolutionError extends Error {
  readonly code = 'event_audience_lookup_failed';
  constructor(message = 'event_audience_lookup_failed') {
    super(message);
    this.name = 'AudienceResolutionError';
  }
}

/**
 * Conservative page size. Must stay well below any plausible PostgREST
 * max-rows setting.
 */
export const PAGE_SIZE = 200;

/** Bounded chunk size for `.in(...)` argument lists. */
const CHUNK_SIZE = 200;

/** Hard stop so a misbehaving backend cannot spin forever. */
const MAX_PAGES = 10_000;

/**
 * Paginate a recipient-source query to completion.
 *
 * `build` is a factory so every page starts from a fresh query builder.
 * Ordering is explicit and stable; ranges are explicit. Any error throws
 * `AudienceResolutionError` — partial rows are never returned.
 */
export async function paginateColumn(
  build: () => any,
  column: string,
  label: string,
): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build()
      .order(column, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      // Sanitised log only — never surface DB text to callers.
      console.error(
        '[EVENT-NOTIFY] Recipient source read failed',
        label,
        (error as any)?.code ?? '',
      );
      throw new AudienceResolutionError();
    }
    const rows = data || [];
    for (const r of rows) {
      const v = r?.[column];
      if (v) out.push(v as string);
    }
    if (rows.length < PAGE_SIZE) return out;
    offset += PAGE_SIZE;
  }
  console.error('[EVENT-NOTIFY] Recipient pagination exceeded page limit', label);
  throw new AudienceResolutionError();
}

function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function resolveRecipients(
  supabase: any,
  eventId: string,
  clubId: string,
  teamId: string | null,
  miniLeagueId: string | null,
  excludeUserId: string,
): Promise<string[]> {
  if (miniLeagueId) {
    // Mini-league events route ONLY to league members:
    // - parents/player-users in this mini_league
    // - mini_league_admins for this league
    // - league_admin role-holders for this club
    // Club-wide coaches/club_admins are intentionally excluded.
    const [parentIds, leagueAdminIds, roleAdminIds] = await Promise.all([
      paginateColumn(
        () =>
          supabase
            .from('mini_league_players')
            .select('parent_user_id')
            .eq('mini_league_id', miniLeagueId)
            .not('parent_user_id', 'is', null),
        'parent_user_id',
        'mini_league_players',
      ),
      paginateColumn(
        () =>
          supabase
            .from('mini_league_admins')
            .select('user_id')
            .eq('mini_league_id', miniLeagueId),
        'user_id',
        'mini_league_admins',
      ),
      paginateColumn(
        () =>
          supabase
            .from('user_roles')
            .select('user_id')
            .eq('role', 'league_admin')
            .eq('club_id', clubId),
        'user_id',
        'user_roles(league_admin)',
      ),
    ]);
    return [...new Set([...parentIds, ...leagueAdminIds, ...roleAdminIds])].filter(
      (id) => id !== excludeUserId,
    );
  }

  if (teamId) {
    const ids = await paginateColumn(
      () =>
        supabase
          .from('user_roles')
          .select('user_id')
          .eq('team_id', teamId)
          .neq('user_id', excludeUserId),
      'user_id',
      'user_roles(team)',
    );
    return [...new Set(ids)];
  }

  // Club-wide. If the event is role-restricted, only invite those roles plus club admins.
  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('restricted_to_roles, target_team_ids')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) {
    // FAIL CLOSED. Falling through here would treat a targeted or
    // role-restricted event as an unrestricted club-wide event and notify
    // members who were never invited. Sanitised log only.
    console.error(
      '[EVENT-NOTIFY] Audience lookup failed',
      (eventError as any)?.code ?? '',
    );
    throw new AudienceResolutionError('event_audience_lookup_failed');
  }

  const restrictedRoles = Array.isArray(eventRow?.restricted_to_roles)
    ? eventRow.restricted_to_roles
    : [];
  const rolesToInvite = restrictedRoles.length > 0
    ? [...new Set([...restrictedRoles, 'club_admin'])]
    : null;

  // Targeted club-wide events: only fan out to members/coaches/team_admins
  // of the targeted teams, guardians of children assigned to them, plus
  // club-level admins/committee. Non-targeted same-club members are excluded.
  const targetTeamIds: string[] = Array.isArray(eventRow?.target_team_ids)
    ? eventRow.target_team_ids
    : [];
  if (targetTeamIds.length > 0) {
    const teamIdChunks = chunk(targetTeamIds);

    const [teamRoleIdLists, adminIds, guardianIds] = await Promise.all([
      Promise.all(
        teamIdChunks.map((ids) =>
          paginateColumn(
            () =>
              supabase
                .from('user_roles')
                .select('user_id')
                .in('team_id', ids)
                .neq('user_id', excludeUserId),
            'user_id',
            'user_roles(targeted teams)',
          )
        ),
      ),
      paginateColumn(
        () =>
          supabase
            .from('user_roles')
            .select('user_id')
            .eq('club_id', clubId)
            .in('role', ['club_admin', 'committee_member'])
            .neq('user_id', excludeUserId),
        'user_id',
        'user_roles(club admins)',
      ),
      (async () => {
        // Guardians of children assigned to any targeted team. Every read here
        // is paginated and fail-closed: a partial guardian list would silently
        // drop invited families.
        const assignLists = await Promise.all(
          teamIdChunks.map((ids) =>
            paginateColumn(
              () =>
                supabase
                  .from('child_team_assignments')
                  .select('child_id')
                  .in('team_id', ids),
              'child_id',
              'child_team_assignments',
            )
          ),
        );
        const childIds = [...new Set(assignLists.flat())];
        if (childIds.length === 0) return [] as string[];
        const guardianLists = await Promise.all(
          chunk(childIds).map((ids) =>
            paginateColumn(
              () =>
                supabase
                  .from('child_guardians')
                  .select('guardian_id')
                  .in('child_id', ids),
              'guardian_id',
              'child_guardians',
            )
          ),
        );
        return guardianLists.flat().filter((id) => id && id !== excludeUserId);
      })(),
    ]);

    return [
      ...new Set([...teamRoleIdLists.flat(), ...adminIds, ...guardianIds]),
    ];
  }

  const ids = await paginateColumn(
    () => {
      let query = supabase
        .from('user_roles')
        .select('user_id')
        .eq('club_id', clubId)
        .neq('user_id', excludeUserId);
      if (rolesToInvite) query = query.in('role', rolesToInvite);
      return query;
    },
    'user_id',
    'user_roles(club)',
  );
  return [...new Set(ids)];
}
