import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { withFeatureBackend } from '@/live/featureRouter';
import { getLiveActiveGame } from '@/live/features/events';

export function boardQueryOptions(gameId: string, userId: string | undefined, icp: boolean) {
  return queryOptions({
    queryKey: ['board-link-card', gameId, userId, icp],
    queryFn: async () => {
      if (icp) return withFeatureBackend('events', {
        supabase: async () => { throw new Error('unreachable'); },
        icp: async ctx => {
          const [row] = await getLiveActiveGame(ctx, gameId);
          if (!row) return null;
          return { id: gameId, team_id: gameId, is_active: row.is_active ?? true,
            pitch_state: typeof row.pitch_state_json === 'string' ? JSON.parse(row.pitch_state_json) : {},
            timer_state: typeof row.timer_state_json === 'string' ? JSON.parse(row.timer_state_json) : {},
            teams: null as { name?: string; clubs?: { sport?: string } } | null };
        },
      }, { teamId: gameId });
      const { data, error } = await supabase.from('active_games')
        .select('id, team_id, is_active, updated_at, pitch_state, timer_state, teams(id, name, club_id, clubs!club_id(sport))')
        .eq('id', gameId).maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5_000,
    gcTime: 24 * 60 * 60_000,
  });
}
