import { withFeatureBackend } from '@/live/featureRouter';
import { readContentInScope } from '@/live/contentRouting';
import { readMembershipInScope } from '@/live/membershipRouting';

export async function readIcpPitchRoster(teamId: string) {
  return withFeatureBackend('membership', {
    supabase: async () => { throw new Error('ICP roster required'); },
    icp: async ctx => {
      const { getLiveTeam } = await import('@/live/features/club');
      const { listLiveTeamRoleGrants } = await import('@/live/features/membership');
      const { listLiveChildTeamAssignments } = await import('@/live/features/events');
      const { listLiveProfilesByIds } = await import('@/live/features/identityAccessClient');
      const { resolveLivePiiTextBatch } = await import('@/live/features/vault');
      const [team] = await getLiveTeam(ctx, teamId);
      if (!team?.club_id) throw new Error('Team club could not be verified');
      const [grants, assignments] = await Promise.all([
        listLiveTeamRoleGrants(ctx, teamId),
        readContentInScope(ctx, 'events', { clubId: team.club_id }, scoped => listLiveChildTeamAssignments(scoped, team.club_id, teamId)),
      ]);
      const [profiles, names] = await Promise.all([
        listLiveProfilesByIds(ctx, [...new Set(grants.map(g => g.user.toText()))]),
        readMembershipInScope(ctx, { clubId: team.club_id }, scoped => resolveLivePiiTextBatch(scoped, assignments.map(a => a.child_id), 'name', 'Read pitch roster', 'Team player names')),
      ]);
      const byUser = new Map(profiles.map(p => [p.account_id, p]));
      return {
        members: grants.map(g => ({ id: `${teamId}:${g.user.toText()}:${g.role}`, user_id: g.user.toText(), role: g.role,
          profiles: { display_name: byUser.get(g.user.toText())?.display_name ?? 'Member', avatar_url: byUser.get(g.user.toText())?.avatar_ref[0] ?? null } })),
        children: assignments.map(a => ({ child_id: a.child_id, child_name: names.get(a.child_id) ?? 'Player' })),
      };
    },
  }, { teamId });
}