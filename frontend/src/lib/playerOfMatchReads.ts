import { supabase } from '@/integrations/supabase/client';
import { withFeatureBackend } from '@/live/featureRouter';

/** Team rewards take precedence; only club-wide rewards are a fallback. */
export async function readPlayerOfMatchRewards(clubId: string, teamId?: string | null) {
  return withFeatureBackend('points', {
    supabase: async () => {
      if (teamId) {
        const { data, error } = await supabase.from('club_rewards').select('*')
          .eq('club_id', clubId).eq('team_id', teamId).eq('reward_type', 'player_of_match')
          .eq('is_active', true).order('created_at', { ascending: true });
        if (error) throw error;
        if (data?.length) return data;
      }
      const { data, error } = await supabase.from('club_rewards').select('*')
        .eq('club_id', clubId).is('team_id', null).eq('reward_type', 'player_of_match')
        .eq('is_active', true).order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    icp: async (ctx) => {
      const { listLiveClubRewards } = await import('@/live/features/points');
      // A null team filter returns the club catalog, including team rewards.
      const all = (await listLiveClubRewards(ctx, clubId, null, true))
        .filter(r => r.club_id === clubId && r.is_active && r.reward_type === 'player_of_match');
      const team = teamId ? all.filter(r => r.team_id[0] === teamId) : [];
      return (team.length ? team : all.filter(r => r.team_id.length === 0))
        .sort((a, b) => a.created_at_ms < b.created_at_ms ? -1 : a.created_at_ms > b.created_at_ms ? 1 : 0)
        .map(r => ({ ...r, team_id: r.team_id[0] ?? null,
          description: r.description[0] ?? null, logo_url: r.logo_url[0] ?? null,
          qr_code_url: r.qr_code_url[0] ?? null, sponsor_id: r.sponsor_id[0] ?? null,
          created_at: new Date(Number(r.created_at_ms)).toISOString() }));
    },
  }, { clubId });
}

export async function readPlayerOfMatchAdults(clubId: string, teamId?: string | null): Promise<string[]> {
  if (!teamId) return [];
  return withFeatureBackend('membership', {
    supabase: async () => {
      const { data, error } = await supabase.from('user_roles').select('user_id')
        .eq('team_id', teamId).eq('role', 'player');
      if (error) throw error;
      return (data ?? []).map(r => r.user_id);
    },
    icp: async (ctx) => {
      const { listLiveRoleGrants } = await import('@/live/features/membership');
      return [...new Set((await listLiveRoleGrants(ctx, clubId))
        .filter(r => r.role === 'player' && r.team[0] === teamId)
        .map(r => r.account_id.replace(/^principal:/, '')))];
    },
  }, { clubId });
}

export interface ProfileSummary {
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * Display names/avatars for a set of account IDs, routed by backend. ICP
 * event rosters carry no profile enrichment, so award dialogs (captain,
 * player of the match) hydrate names through this reader instead of showing
 * "Unknown" for every adult.
 */
export async function readProfileSummaries(ids: string[], clubId?: string | null): Promise<Map<string, ProfileSummary>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  return withFeatureBackend('membership', {
    supabase: async () => {
      const { selectCachedProfilesByIds } = await import('@/lib/profileCache');
      const { data } = await selectCachedProfilesByIds(unique);
      return new Map((data ?? []).map((p: any) => [p.id as string, {
        display_name: p.display_name ?? null,
        avatar_url: p.avatar_url ?? null,
      }]));
    },
    icp: async (ctx) => {
      const { listLiveProfilesByIds } = await import('@/live/features/identityAccessClient');
      const profiles = await listLiveProfilesByIds(ctx, unique, clubId ? { clubId } : undefined);
      return new Map((profiles as any[]).map((p) => [p.account_id as string, {
        display_name: p.display_name ?? null,
        avatar_url: p.avatar_ref?.[0] ?? null,
      }]));
    },
  }, { shared: 'person' });
}