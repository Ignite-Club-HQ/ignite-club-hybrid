/**
 * Local port of the `getTeamStaffUserIds` recipient-policy helper defined
 * inline in `supabase/functions/check-pending-subs/index.ts`
 * (see reference/backend/supabase/functions/check-pending-subs/index.ts.md).
 *
 * Get notification recipients for a specific team/match. For mini-league
 * matches (event-group-*), only Referee/Subs Manager duty assignees for that
 * exact group receive notifications. For regular teams, notify staff scoped
 * to THIS team only (per admin-configurable role toggles), plus any assigned
 * match duties.
 */

export async function getTeamStaffUserIds(
  supabase: any,
  teamId: string | null | undefined,
  linkedEventId?: string,
): Promise<string[]> {
  const userIds = new Set<string>();

  const isMiniLeague = teamId?.startsWith('event-group-');

  if (isMiniLeague) {
    // Mini-league: only notify the Referee/Subs Manager of this specific match.
    const groupId = teamId!.replace('event-group-', '');
    const { data: matchDutyAssignees } = await supabase
      .from('event_group_duties')
      .select('assigned_to')
      .eq('group_id', groupId)
      .in('name', ['Referee', 'Subs Manager'])
      .not('assigned_to', 'is', null);

    matchDutyAssignees?.forEach((d: any) => {
      if (d.assigned_to) userIds.add(d.assigned_to);
    });

    console.log(`[CHECK-SUBS] Mini-league match ${groupId}: ${userIds.size} duty assignee(s) found`);
  } else {
    // Load per-team role filters. Admins can disable pitch-board pushes for
    // specific roles (coach / team_admin / subs_manager) from the pitch board
    // settings dialog. Defaults to ON for any column that's missing or null
    // so existing teams keep their current behaviour.
    let notifyCoach = true;
    let notifyTeamAdmin = true;
    let notifySubsManager = true;
    if (teamId) {
      const { data: subRow } = await supabase
        .from('team_subscriptions')
        .select('pitch_notify_coach, pitch_notify_team_admin, pitch_notify_subs_manager')
        .eq('team_id', teamId)
        .maybeSingle();
      if (subRow) {
        notifyCoach = subRow.pitch_notify_coach !== false;
        notifyTeamAdmin = subRow.pitch_notify_team_admin !== false;
        notifySubsManager = subRow.pitch_notify_subs_manager !== false;
      }
    }

    if (teamId) {
      const enabledRoles: string[] = [];
      if (notifyTeamAdmin) enabledRoles.push('team_admin');
      if (notifyCoach) enabledRoles.push('coach');

      if (enabledRoles.length > 0) {
        const { data, error } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('team_id', teamId)
          .in('role', enabledRoles);

        if (error) {
          console.error('[CHECK-SUBS] Error fetching team staff:', error?.message);
        } else {
          data?.forEach((r: any) => userIds.add(r.user_id as string));
        }
      }
    }

    if (linkedEventId) {
      // Subs Manager (gated by notifySubsManager) and Referee (always on)
      const dutyNames: string[] = ['Referee'];
      if (notifySubsManager) dutyNames.push('Subs Manager');

      const { data: dutyAssignees } = await supabase
        .from('duties')
        .select('assigned_to')
        .eq('event_id', linkedEventId)
        .in('name', dutyNames)
        .not('assigned_to', 'is', null);

      dutyAssignees?.forEach((d: any) => {
        if (d.assigned_to) userIds.add(d.assigned_to);
      });
    }
  }

  return [...userIds];
}
