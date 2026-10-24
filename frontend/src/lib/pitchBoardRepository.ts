import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { withFeatureBackend } from '@/live/featureRouter';
import { writeOnce } from '@/live/clubScope';
import type { PitchPosition } from '@/components/pitch/PositionBadge';

const positions: readonly string[] = ['GK', 'DEF', 'MID', 'FWD'];
const canonicalPositions = (values: string[]) => values.filter(
  (value): value is PitchPosition => positions.includes(value),
);

export function pitchPlayerPositionsQuery(teamId: string, userId: string | undefined, icp: boolean) {
  return queryOptions({
    queryKey: ['team-player-positions', teamId, userId, icp],
    queryFn: async () => {
      if (icp) return withFeatureBackend('membership', {
        supabase: async () => { throw new Error('ICP player positions required'); },
        icp: async ctx => {
          const { getLiveTeamPlayerPositionsV2 } = await import('@/live/features/club');
          const rows = await getLiveTeamPlayerPositionsV2(ctx, teamId);
          return rows.map(row => ({
            user_id: row.member_id.replace(/^principal:/, ''),
            child_id: null,
            preferred_positions: canonicalPositions(row.positions),
            jersey_number: Array.isArray(row.jersey_number)
              ? row.jersey_number[0] ?? null : row.jersey_number ?? null,
          }));
        },
      }, { teamId });
      const { data, error } = await supabase.from('team_player_positions').select('*').eq('team_id', teamId);
      if (error) throw error;
      return (data ?? []).map(row => ({
        user_id: row.user_id, child_id: row.child_id,
        preferred_positions: canonicalPositions(row.preferred_positions ?? []),
        jersey_number: row.jersey_number,
      }));
    },
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  });
}

export async function readPitchNotificationPreference(userId: string, icp: boolean): Promise<boolean> {
  if (icp) return withFeatureBackend('notifications', {
    supabase: async () => { throw new Error('ICP preferences required'); },
    icp: async ctx => {
      const { getLiveNotificationPreferences } = await import('@/live/features/notifications');
      return (await getLiveNotificationPreferences(ctx, userId)).pitchBoardEnabled;
    },
  }, { shared: 'person' });
  const { data, error } = await supabase.from('notification_preferences')
    .select('pitch_board_enabled').eq('user_id', userId).single();
  if (error) throw error;
  return data?.pitch_board_enabled ?? true;
}

/** Self reminder only: broader staff alerts remain owned by the sub monitor. */
export async function notifyIcpSubstitutionDue(teamId: string, eventId: string | null, userId: string, key: string) {
  return withFeatureBackend('membership', {
    supabase: async () => { throw new Error('ICP substitution reminder required'); },
    icp: async ctx => {
      const caller = ctx.identity?.getPrincipal().toText();
      if (!caller || caller !== userId.replace(/^principal:/, '')) throw new Error('Pitch-board account changed');
      let clubId: string;
      if (teamId.startsWith('event-group-')) {
        const { notifyLiveGroupPitch } = await import('@/live/features/events');
        return notifyLiveGroupPitch(ctx, teamId.slice('event-group-'.length), 'substitution', '', key);
      } else {
        const { getLiveTeam } = await import('@/live/features/club');
        const [team] = await getLiveTeam(ctx, teamId);
        if (!team?.club_id) throw new Error('Pitch board has no club scope');
        clubId = team.club_id;
      }
      const { fanOutLiveNotifications } = await import('@/live/features/notifications');
      return fanOutLiveNotifications(ctx, {
        userIds: [caller], clubId, kind: 'pitch_board_substitution',
        body: 'A planned substitution is due', relatedId: teamId,
        idempotencyKeyPrefix: key,
      });
    },
  }, writeOnce(teamId.startsWith('event-group-') ? { eventGroupId: teamId.slice('event-group-'.length) } : { teamId }));
}