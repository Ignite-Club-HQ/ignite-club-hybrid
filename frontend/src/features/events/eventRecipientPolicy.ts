/**
 * Single source of truth for "who should be notified about this event".
 *
 * Both bulk RSVP reminders and "Resend invites" on the Event Detail page use
 * this helper so the two features can never drift apart again.
 *
 * The defect this fixes: for a club-wide event with `target_team_ids`, both
 * paths queried EVERY `user_roles` row for the club, so members of uninvited
 * teams and unrelated club officials were reminded / re-invited.
 *
 * Scopes:
 * - `mini_league`     — mini-league parents + club/league admins + coaches (unchanged)
 * - `team`            — every role row on that team (unchanged)
 * - `club_untargeted` — every role row in the club, filtered by `restricted_to_roles` (unchanged)
 * - `club_targeted`   — RLS-safe RPC that returns exactly: adults with a role on a
 *                       targeted team, primary parents of children assigned to a
 *                       targeted team, and additional guardians of those children.
 *                       Deduped server-side, nulls excluded.
 */

export type EventRecipientContext = {
  eventId: string;
  teamId?: string | null;
  clubId?: string | null;
  miniLeagueId?: string | null;
  targetTeamIds?: string[] | null;
  restrictedToRoles?: string[] | null;
};

export type EventRecipientScope =
  | "mini_league"
  | "team"
  | "club_targeted"
  | "club_untargeted";

export function getEventRecipientScope(ctx: EventRecipientContext): EventRecipientScope {
  if (ctx.miniLeagueId) return "mini_league";
  if (ctx.teamId) return "team";
  const targets = (ctx.targetTeamIds ?? []).filter(Boolean);
  if (targets.length > 0) return "club_targeted";
  return "club_untargeted";
}

const uniq = (ids: (string | null | undefined)[]): string[] =>
  [...new Set(ids.filter((v): v is string => !!v))];

/**
 * Resolve the eligible recipient user ids for an event. Throws on any database
 * failure so callers never insert notifications against a partial audience.
 */
export async function resolveEventRecipients(
  client: any,
  ctx: EventRecipientContext,
): Promise<string[]> {
  const scope = getEventRecipientScope(ctx);

  if (scope === "club_targeted") {
    const { data, error } = await client.rpc(
      "get_targeted_event_notification_recipients",
      { p_event_id: ctx.eventId },
    );
    if (error) throw error;
    return uniq((data ?? []).map((r: any) => (typeof r === "string" ? r : r?.user_id)));
  }

  if (scope === "mini_league") {
    const { data: league, error: leagueError } = await client
      .from("mini_leagues")
      .select("club_id")
      .eq("id", ctx.miniLeagueId!)
      .single();
    if (leagueError) throw leagueError;
    if (!league) return [];

    const [playersRes, adminsRes] = await Promise.all([
      client
        .from("mini_league_players")
        .select("parent_user_id")
        .eq("mini_league_id", ctx.miniLeagueId!)
        .not("parent_user_id", "is", null),
      client
        .from("user_roles")
        .select("user_id")
        .eq("club_id", league.club_id)
        .in("role", ["club_admin", "league_admin", "coach"]),
    ]);
    if (playersRes.error) throw playersRes.error;
    if (adminsRes.error) throw adminsRes.error;

    return uniq([
      ...(playersRes.data ?? []).map((p: any) => p.parent_user_id),
      ...(adminsRes.data ?? []).map((r: any) => r.user_id),
    ]);
  }

  let query = client.from("user_roles").select("user_id, role");
  if (scope === "team") {
    query = query.eq("team_id", ctx.teamId!);
  } else {
    query = query.eq("club_id", ctx.clubId!);
  }
  const { data, error } = await query;
  if (error) throw error;

  const restricted = (ctx.restrictedToRoles ?? []).filter(Boolean);
  const rows = restricted.length > 0
    ? (data ?? []).filter(
        (m: any) =>
          restricted.includes(m.role) || m.role === "club_admin" || m.role === "app_admin",
      )
    : (data ?? []);

  return uniq(rows.map((m: any) => m.user_id));
}

/** Build the recipient context from an `events` row. */
export function eventRecipientContext(event: any, eventId: string): EventRecipientContext {
  return {
    eventId,
    teamId: event?.team_id ?? null,
    clubId: event?.club_id ?? null,
    miniLeagueId: event?.mini_league_id ?? null,
    targetTeamIds: Array.isArray(event?.target_team_ids) ? event.target_team_ids : null,
    restrictedToRoles: Array.isArray(event?.restricted_to_roles)
      ? event.restricted_to_roles
      : null,
  };
}
