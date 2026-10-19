import { writeOnce } from "@/live/clubScope";
import { withFeatureBackend } from "@/live/featureRouter";

/**
 * ICP (club_domain) counterparts of the Supabase user_roles reads/deletes used
 * by team-chat member management. Member ids may arrive as "principal:<text>".
 */
const opt = (v: unknown) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const normId = (id: string) => (id.startsWith("principal:") ? id.slice(10) : id);

export async function listIcpTeamMemberRoles(teamId: string, memberId: string) {
  const target = normId(memberId);
  return withFeatureBackend("membership", {
    supabase: async () => [] as { id: string; role: string }[],
    icp: async (ctx) => {
      const { listLiveTeamRoleGrants } = await import("@/live/features/membership");
      const grants = (await listLiveTeamRoleGrants(ctx, teamId)) as any[];
      return grants
        .filter((g) => String(g.user?.toText?.() ?? g.user) === target && opt(g.team) === teamId)
        .map((g) => ({ id: `${teamId}:${g.role}`, role: String(g.role) }));
    },
  }, { teamId: teamId! });
}

export async function removeIcpTeamRoles(clubId: string, teamId: string, memberId: string, roles: string[]) {
  await withFeatureBackend("membership", {
    supabase: async () => {
      throw new Error("unreachable");
    },
    icp: async (ctx) => {
      const [{ Principal }, { removeLiveRoleGrant }] = await Promise.all([
        import("@icp-sdk/core/principal"),
        import("@/live/features/membership"),
      ]);
      const p = Principal.fromText(normId(memberId));
      for (const role of roles) if (role) await removeLiveRoleGrant(ctx, p, clubId, role, teamId);
    },
  }, writeOnce({ clubId }));
}
