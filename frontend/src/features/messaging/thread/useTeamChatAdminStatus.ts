import { useQuery } from "@tanstack/react-query";

/**
 * Minimal Supabase client surface this hook needs. Callers pass their page's
 * existing `supabase` client instance so this module never owns its own
 * `integrations/supabase/client` import (keeps the quality-ratchet's
 * `directSupabaseImports` count unaffected by this extraction).
 */
export interface TeamChatSupabaseClient {
  from: (table: string) => any;
}

interface UseTeamChatAdminStatusParams {
  supabaseClient: TeamChatSupabaseClient;
  teamId: string | undefined;
  userId: string | undefined;
  clubId: string | null | undefined;
  enabled: boolean;
}

/**
 * Resolves whether the current user is an admin for this team chat — i.e. a
 * team_admin/coach on the team, a club_admin on the owning club, or an
 * app_admin. Runs the three role checks in parallel.
 */
export function useTeamChatAdminStatus({
  supabaseClient,
  teamId,
  userId,
  clubId,
  enabled,
}: UseTeamChatAdminStatusParams) {
  return useQuery({
    queryKey: ["team-chat-admin", teamId, userId, clubId],
    queryFn: async () => {
      if (!userId || !teamId) return false;
      const [teamRoleResult, clubRoleResult, appAdminResult] = await Promise.all([
        supabaseClient
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("team_id", teamId)
          .in("role", ["team_admin", "coach"])
          .maybeSingle(),
        clubId
          ? supabaseClient
              .from("user_roles")
              .select("role")
              .eq("user_id", userId)
              .eq("club_id", clubId)
              .eq("role", "club_admin")
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabaseClient
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "app_admin")
          .maybeSingle(),
      ]);

      return !!teamRoleResult.data || !!clubRoleResult.data || !!appAdminResult.data;
    },
    enabled: enabled && !!teamId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
