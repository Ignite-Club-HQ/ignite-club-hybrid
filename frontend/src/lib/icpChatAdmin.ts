import { withFeatureBackend } from "@/live/featureRouter";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

/**
 * Chat admin check for secure-sign-in (ICP) users, whose roles live in
 * club_domain grants — Supabase user_roles is always empty for them.
 * Returns null when the chat isn't on ICP, so callers fall back to Supabase.
 */
export async function resolveIcpChatAdmin(opts: {
  clubId?: string | null;
  teamId?: string | null;
  teamRoles?: string[];
}): Promise<boolean | null> {
  if (!isFeatureRoutedToIcp("messaging")) return null;
  return withFeatureBackend<boolean | null>("messaging", {
    supabase: async () => null,
    icp: async (ctx) => {
      const { getLiveMyRoleGrants } = await import("@/live/features/membership");
      const grants = ((await getLiveMyRoleGrants(ctx).catch(() => [])) as any[]) ?? [];
      const teamRoles = opts.teamRoles ?? ["team_admin", "coach"];
      return grants.some((g) => {
        const club = (Array.isArray(g.club) ? g.club[0] : g.club) ?? null;
        const team = (Array.isArray(g.team) ? g.team[0] : g.team) ?? null;
        if (g.role === "app_admin") return true;
        if (opts.clubId && club === opts.clubId && !team && (g.role === "club_admin" || g.role === "committee_member")) return true;
        if (opts.teamId && team === opts.teamId && teamRoles.includes(g.role)) return true;
        return false;
      });
    },
  });
}
