import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { readHomeSectionSnapshot, writeHomeSectionSnapshot } from "@/lib/homeSectionSnapshot";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabNewsPost, getLocalLabNewsPosts, getLocalLabTeamList } from "@/lab/fixtureDataLayer";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveNews, listLiveNewsMulti, listLiveTeams, getLiveTeam } from "@/live/features/club";
import { getLiveMyRoleGrants, listLiveMembershipClubs } from "@/live/features/membership";

/**
 * Map a club_domain NewsPost onto the club_news row shape the UI consumes.
 * Provisional: the canister has no image/target-team/important fields, and
 * author_id is an ICP principal rendered as text — verify post-deploy.
 */
function liveNewsPostToRow(post: {
  id: string;
  club_id: string;
  title: string;
  body: string;
  status: string;
  created_by: { toText?: () => string };
  created_at_ms: bigint;
}): ClubNewsRow {
  return {
    id: post.id,
    club_id: post.club_id,
    title: post.title,
    content: post.body,
    image_url: null,
    author_id: post.created_by?.toText?.() ?? String(post.created_by),
    target_team_ids: null,
    is_important: false,
    published_at: new Date(Number(post.created_at_ms)).toISOString(),
  };
}

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
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  return useQuery<ClubNewsRow[]>({
    queryKey: ["club-news", clubId ?? "all", limit],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabNewsPosts(clubId ?? "club-icp-001").slice(0, limit) as ClubNewsRow[];
      }
      return withFeatureBackend("news", {
        supabase: async () => {
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
        icp: async (ctx) => {
          // Provisional: with no club filter the feed unions the member's
          // clubs (the canister requires club ids); the member's club ids
          // come from the club_domain whoami account record.
          const posts = clubId
            ? await listLiveNews(ctx, clubId)
            : await (async () => {
                // Provisional: with no club filter the feed unions the clubs
                // visible to the caller (list_clubs is caller-scoped).
                const { listLiveMembershipClubs } = await import("@/live/features/membership");
                const clubs = await listLiveMembershipClubs(ctx);
                const clubIds = clubs.map((c) => c.id);
                if (clubIds.length === 0) return [];
                return listLiveNewsMulti(ctx, clubIds);
              })();
          const rows = (posts as Array<Parameters<typeof liveNewsPostToRow>[0]>)
            .filter((p) => p.status === "published")
            .map(liveNewsPostToRow)
            .slice(0, limit);
          writeHomeSectionSnapshot("club-news", snapshotScope, rows);
          return rows;
        },
      });
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
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  return useQuery<ClubNewsRow | null>({
    queryKey: ["club-news-post", newsId],
    queryFn: async () => {
      if (useIcpLab) return getLocalLabNewsPost(newsId!) as ClubNewsRow | null;
      return withFeatureBackend("news", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("club_news")
            .select(NEWS_COLUMNS)
            .eq("id", newsId!)
            .maybeSingle();
          if (error) throw error;
          return (data as ClubNewsRow | null) ?? null;
        },
        icp: async (ctx) => {
          // The canister has no get-by-id; resolve the post via the caller's
          // clubs (role grants) and filter. Provisional — verify post-deploy.
          const { listLiveMembershipClubs } = await import("@/live/features/membership");
          const clubs = await listLiveMembershipClubs(ctx);
          const clubIds = clubs.map((c) => c.id);
          if (clubIds.length === 0) return null;
          const posts = await listLiveNewsMulti(ctx, clubIds);
          const post = (posts as Array<Parameters<typeof liveNewsPostToRow>[0]>)
            .find((p) => p.id === newsId);
          return post ? liveNewsPostToRow(post) : null;
        },
      });
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
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["news-publishable-clubs", user?.id],
    queryFn: async () => {
      if (useIcpLab) return [];
      return withFeatureBackend("membership", {
        supabase: async () => {
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
        icp: async (ctx) => {
          const grants = await getLiveMyRoleGrants(ctx);
          const adminClubIds = Array.from(new Set(grants.filter(g => g.role === "club_admin").flatMap(g => g.club)));
          if (adminClubIds.length === 0) return [];
          const clubs = await listLiveMembershipClubs(ctx);
          return clubs.filter(c => adminClubIds.includes(c.id)).map(c => ({ id: c.id, name: c.name }));
        }
      });
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClubTeamsForNews(clubId?: string | null) {
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["club-teams-for-news", clubId],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabTeamList()
          .filter((team) => team.club_id === clubId)
          .map(({ id, name }) => ({ id, name }));
      }
      return withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("teams")
            .select("id, name")
            .eq("club_id", clubId!)
            .order("name");
          if (error) throw error;
          return (data || []) as Array<{ id: string; name: string }>;
        },
        icp: async (ctx) => {
          const teams = await listLiveTeams(ctx, clubId!);
          return teams.map(t => ({ id: t.id, name: t.name }));
        }
      });
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
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["news-team-names", ids.slice().sort().join(",")],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabTeamList()
          .filter((team) => ids.includes(team.id))
          .map(({ id, name }) => ({ id, name }));
      }
      return withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase.from("teams").select("id, name").in("id", ids);
          if (error) throw error;
          return (data || []) as Array<{ id: string; name: string }>;
        },
        icp: async (ctx) => {
          // list_teams requires a club_id; fetch each team individually.
          // Inefficient, but matches the deep-link use case documented above.
          const teams = await Promise.all(ids.map(id => getLiveTeam(ctx, id)));
          return teams.map(t => t[0]).filter(Boolean).map(t => ({ id: t!.id, name: t!.name }));
        }
      });
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
