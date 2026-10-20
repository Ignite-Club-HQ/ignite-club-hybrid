/** Keep optional newer columns from breaking older Supabase deployments. */
const scheduleColumns = `
  id, title, type, event_date, start_time, end_time, description,
  address, suburb, state, postcode, location_name, club_id, team_id,
  competition_match_id, mini_league_id, target_team_ids, is_cancelled,
  is_bye, is_recurring, parent_event_id, opponent, arrival_minutes_before,
  rsvp_audience, adults_only, updated_at,
  teams!events_team_id_fkey (name, default_match_arrival_minutes, default_rsvp_audience),
  clubs!events_club_id_fkey (name, sport)
`;

function missingDutyTeamColumn(error: any): boolean {
  return (error?.code === "42703" || error?.code === "PGRST204") &&
    /\bduty_team_id\b/.test(String(error?.message ?? ""));
}

export async function readScheduleEvents(
  client: any,
  configure: (query: any) => any,
) {
  const read = (includeDutyTeam: boolean) => configure(
    client.from("events").select(
      includeDutyTeam ? `${scheduleColumns}, duty_team_id` : scheduleColumns,
    ),
  );
  const result = await read(true);
  if (!missingDutyTeamColumn(result.error)) return result;
  // Retry only a definite schema refusal, not permissions, transport or timeouts.
  // Preserve exactly the same date/entity filters and RLS-bound client.
  const legacy = await read(false);
  return {
    ...legacy,
    data: legacy.data?.map((row: any) => ({ ...row, duty_team_id: null })) ?? null,
  };
}