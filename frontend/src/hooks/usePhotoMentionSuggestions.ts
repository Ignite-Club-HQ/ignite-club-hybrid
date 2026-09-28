import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MentionScope {
  teamId?: string | null;
  clubId?: string | null;
  miniLeagueId?: string | null;
}

export interface MentionUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * Fetches users available to @mention inside a photo comment.
 * Mentions are strictly scoped to the photo's audience so a user can never be
 * tagged into a feed they don't belong to:
 *   - team photo  → members of that team
 *   - mini-league → league admins + per-league admins + parents of league players
 *   - club photo  → members of that club
 */
export function usePhotoMentionSuggestions(
  scope: MentionScope,
  search: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "photo-mention-users",
      scope.teamId ?? null,
      scope.clubId ?? null,
      scope.miniLeagueId ?? null,
      search.toLowerCase(),
    ],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<MentionUser[]> => {
      let userIds: string[] = [];

      if (scope.teamId) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("team_id", scope.teamId);
        userIds = [...new Set((roles ?? []).map((r) => r.user_id).filter(Boolean))];
      } else if (scope.miniLeagueId) {
        const mlId = scope.miniLeagueId;
        const [leagueRow, perLeagueAdmins, players] = await Promise.all([
          supabase.from("mini_leagues").select("club_id").eq("id", mlId).maybeSingle(),
          supabase.from("mini_league_admins").select("user_id").eq("mini_league_id", mlId),
          supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", mlId)
            .not("parent_user_id", "is", null),
        ]);
        const ids = new Set<string>();
        const mlClubId = (leagueRow.data as { club_id?: string } | null)?.club_id;
        if (mlClubId) {
          const { data: clubRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", mlClubId)
            .eq("role", "league_admin");
          (clubRoles ?? []).forEach((r) => ids.add(r.user_id));
        }
        (perLeagueAdmins.data ?? []).forEach((a) => ids.add(a.user_id));
        (players.data ?? []).forEach((p) => {
          const pid = (p as { parent_user_id?: string }).parent_user_id;
          if (pid) ids.add(pid);
        });
        userIds = [...ids];
      } else if (scope.clubId) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", scope.clubId);
        userIds = [...new Set((roles ?? []).map((r) => r.user_id).filter(Boolean))];
      }

      if (userIds.length === 0) return [];

      const safe = search.replace(/[\\%_]/g, (m) => `\\${m}`);
      let q = supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds)
        .not("display_name", "is", null)
        .limit(6);
      if (safe) q = q.ilike("display_name", `%${safe}%`);
      const { data } = await q;
      return (data ?? []) as MentionUser[];
    },
  });
}
