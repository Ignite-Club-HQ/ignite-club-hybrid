import { withFeatureBackend } from '@/live/featureRouter';

/** Manager-authorized invitations only; never read historical plaintext emails. */
export async function readIcpTeamPendingInvites(clubId: string, teamId: string) {
  return withFeatureBackend('membership', {
    supabase: async () => { throw new Error('ICP invitations required'); },
    icp: async ctx => {
      const { listLivePendingInvitesByClub, getLivePendingInviteLabel } = await import('@/live/features/club');
      const rows = await listLivePendingInvitesByClub(ctx, clubId);
      return Promise.all(rows
        .filter(row => row.team_id[0] === teamId && (row.status === 'pending' || row.status === 'resent'))
        .map(async row => ({
          id: row.id,
          role: row.role[0] ?? 'parent',
          invited_user_id: null,
          invited_label: (await getLivePendingInviteLabel(ctx, row.id))[0] ?? 'Invitation',
          created_at: new Date(Number(row.created_at_ms)).toISOString(),
          status: 'pending',
          profiles: null,
        })));
    },
  }, { clubId });
}