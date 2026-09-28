import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { readHomeSectionSnapshot, writeHomeSectionSnapshot } from "@/lib/homeSectionSnapshot";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabNewsPost, getLocalLabNewsPosts, getLocalLabTeamList } from "@/lab/fixtureDataLayer";

/**
 * Club News data access.
 *
 * News is official, persistent club information — deliberately separate from
 * chat/broadcast messaging. RLS on `club_news` is the security boundary:
 * members only see published posts for their club whose audience (whole club
 * or selected teams) includes them, so an optional `clubId` here only narrows
 * an already-authorised set.
 */
export interface ClubNewsRow {
  id: string;
  club_id: string;
  title: string;
  content: string;
  image_url: string | null;
  author_id: string | null;
  target_team_ids: string[] | null;
  is_important: boolean;
  published_at: string;
  attachments?: unknown;
}

const NEWS_COLUMNS =
  "id, club_id, title, content, image_url, author_id, target_team_ids, is_important, published_at, attachments";


export function useClubNewsFeed(clubId?: string | null, limit = 50) {
  const snapshotScope = `${clubId ?? "all"}_${limit}`;
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  return useQuery<ClubNewsRow[]>({
    queryKey: ["club-news", clubId ?? "all", limit],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabNewsPosts(clubId ?? "club-icp-001").slice(0, limit) as ClubNewsRow[];
      }
      let query = supabase
        .from("club_news")
        .select(NEWS_COLUMNS)
        .eq("is_published", true)
        .order("published_at", { ascending: false })
        .limit(limit);

      if (clubId) query = query.eq("club_id", clubId);

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []) as ClubNewsRow[];
      writeHomeSectionSnapshot("club-news", snapshotScope, rows);
      return rows;
    },
    // Paint the last known posts immediately on cold open so the Home section
    // doesn't pop in after everything else.
    placeholderData: () =>
      readHomeSectionSnapshot<ClubNewsRow[]>("club-news", snapshotScope) ?? undefined,
    staleTime: 2 * 60 * 1000,
  });
}


/** Latest single post — powers the compact Home section. */
export function useLatestClubNews(clubId?: string | null) {
  const feed = useClubNewsFeed(clubId, 1);
  return { ...feed, latest: feed.data?.[0] ?? null };
}

export function useClubNewsPost(newsId?: string | null) {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  return useQuery<ClubNewsRow | null>({
    queryKey: ["club-news-post", newsId],
    queryFn: async () => {
      if (useIcpLab) return getLocalLabNewsPost(newsId!) as ClubNewsRow | null;
      const { data, error } = await supabase
        .from("club_news")
        .select(NEWS_COLUMNS)
        .eq("id", newsId!)
        .maybeSingle();
      if (error) throw error;
      return (data as ClubNewsRow | null) ?? null;
    },
    enabled: !!newsId,
  });
}

/**
 * Clubs where the viewer may publish news. Reuses the existing role model
 * (`club_admin` at club level) — no new role system.
 */
export function useNewsPublishableClubs() {
  const { user } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["news-publishable-clubs", user?.id],
    queryFn: async () => {
      if (useIcpLab) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("club_id, role")
        .eq("user_id", user!.id)
        .in("role", ["club_admin"]);
      if (error) throw error;
      const ids = Array.from(
        new Set((data || []).map((r) => r.club_id).filter(Boolean) as string[]),
      );
      if (ids.length === 0) return [];
      const { data: clubs, error: clubErr } = await supabase
        .from("clubs")
        .select("id, name")
        .in("id", ids);
      if (clubErr) throw clubErr;
      return (clubs || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClubTeamsForNews(clubId?: string | null) {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["club-teams-for-news", clubId],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabTeamList()
          .filter((team) => team.club_id === clubId)
          .map(({ id, name }) => ({ id, name }));
      }
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("club_id", clubId!)
        .order("name");
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!clubId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Resolve team names directly by id. Used by News audience labels so we can
 * always name the targeted teams, even before/without the club team list
 * (e.g. an article opened by deep link before `club_id` teams have loaded).
 */
export function useTeamNamesByIds(teamIds?: string[] | null) {
  const ids = Array.from(new Set((teamIds || []).filter(Boolean)));
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["news-team-names", ids.slice().sort().join(",")],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabTeamList()
          .filter((team) => ids.includes(team.id))
          .map(({ id, name }) => ({ id, name }));
      }
      const { data, error } = await supabase.from("teams").select("id, name").in("id", ids);
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
