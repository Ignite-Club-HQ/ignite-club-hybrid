import type { FeatureBackendContext } from '@/live/featureRouter';

/** Child membership is independent of adult profiles and private-name unlocks. */
export async function readTeamChildRows(ctx: FeatureBackendContext, clubId: string, teamId: string) {
  const [{ readContentInScope }, { listLiveChildTeamAssignments }] = await Promise.all([
    import('@/live/contentRouting'), import('@/live/features/events'),
  ]);
  const assignments = await readContentInScope(ctx, 'events', { clubId }, scoped =>
    listLiveChildTeamAssignments(scoped, clubId, teamId));
  return assignments.map(child => ({ id: child.child_id, child_id: child.child_id,
    children: { id: child.child_id, name: 'Player', year_of_birth: null, parent_id: null, profiles: null, allParentNames: [] } }));
}

export function teamRoleRows(grants: readonly { account_id: string; role: string }[]) {
  return grants.map(grant => {
    const userId = grant.account_id.replace(/^principal:/, '');
    return { id: `${userId}:${grant.role}`, user_id: userId, role: grant.role, profiles: null };
  });
}