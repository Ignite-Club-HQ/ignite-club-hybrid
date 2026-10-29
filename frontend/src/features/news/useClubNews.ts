import { acrossLists } from "@/live/featureScopes";
import { mergeLists } from "@/live/featureRouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { readHomeSectionSnapshot, writeHomeSectionSnapshot } from "@/lib/homeSectionSnapshot";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabNewsPost, getLocalLabNewsPosts, getLocalLabTeamList } from "@/lab/fixtureDataLayer";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveNews, listLiveNewsMulti, listLiveTeams, getLiveTeam } from "@/live/features/club";
import { getLiveMyRoleGrants, listLiveMembershipClubs } from "@/live/features/membership";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { newsPostKey, NEWS_POST_FRESH_MS } from "./newsQueryKeys";

const opt = <T,>(v: [] | [T] | null | undefined): T | null =>
  v && v.length ? v[0] : null;

/**
 * Map a club_domain NewsPost onto the club_news row shape the UI consumes.
 * The newer canister fields are optional so a pre-upgrade canister (old
 * shape) still maps cleanly — they simply read as unset.
 */
function liveNewsPostToRow(post: {
  id: string;
  club_id: string;
  title: string;
  body: string;
  status: string;
  created_by: { toText?: () => string };
  created_at_ms: bigint;
  target_team_ids?: [] | [string[]];
  target_mini_league_id?: [] | [string];
  target_competition_id?: [] | [string];
  is_important?: boolean;
  image_url?: [] | [string];
  attachments?: Array<{
    kind: string;
    url: string;
    name: string;
    size: bigint;
    mime_type: [] | [string];
    anchor: [] | [string];
  }>;
}): ClubNewsRow {
  return {
    id: post.id,
    club_id: post.club_id,
    title: post.title,
    content: post.body,
    image_url: opt(post.image_url),
    author_id: post.created_by?.toText?.() ?? String(post.created_by),
    target_team_ids: opt(post.target_team_ids),
    target_mini_league_id: opt(post.target_mini_league_id),
    target_competition_id: opt(post.target_competition_id),
    is_important: post.is_important ?? false,
    published_at: new Date(Number(post.created_at_ms)).toISOString(),
    attachments: (post.attachments ?? []).map((a) => ({
      kind: a.kind === "image" ? "image" : "file",
      url: a.url,
      name: a.name,
      size: Number(a.size),
      mimeType: opt(a.mime_type),
      anchor: opt(a.anchor),
    })),
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
  target_mini_league_id?: string | null;
  target_competition_id?: string | null;
  is_important: boolean;
  published_at: string;
  attachments?: unknown;
}

const NEWS_COLUMNS =
  "id, club_id, title, content, image_url, author_id, target_team_ids, target_mini_league_id, target_competition_id, is_important, published_at, attachments";


/** Canister tombstone check — soft-deleted clubs keep deleted_at_ms set. */
const isLiveClubDeleted = (club: { deleted_at_ms?: [] | [bigint] }) =>
  (club.deleted_at_ms?.length ?? 0) > 0;

export function useClubNewsFeed(clubId?: string | null, limit = 50) {
  const { user } = useAuth();
  const isIcp = isFeatureRoutedToIcp("news");
  const snapshotScope = `${clubId ?? "all"}_${limit}`;
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  return useQuery<ClubNewsRow[]>({
    queryKey: ["club-news", clubId ?? "all", limit, user?.id, isIcp],
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

          if (clubId) {
            const { data: competitionIds, error: audienceError } = await supabase.rpc("club_news_competition_ids", {
              _club_id: clubId,
            });
            if (audienceError) throw audienceError;
            const ids = (competitionIds ?? []).filter(Boolean);
            query = ids.length > 0
              ? query.or(`club_id.eq.${clubId},target_competition_id.in.(${ids.join(",")})`)
              : query.eq("club_id", clubId);
          }

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
          const posts = await (async () => {
            if (clubId) {
              // A soft-deleted club keeps its newsPosts on the canister;
              // skip the fetch so the feed (and its snapshot) empties.
              const { getLiveClubProfile } = await import("@/live/features/club");
              const profile = await getLiveClubProfile(ctx, clubId);
              if (!profile[0] || isLiveClubDeleted(profile[0])) return [];
              return listLiveNews(ctx, clubId);
            }
            // Provisional: with no club filter the feed unions the clubs
            // visible to the caller (list_clubs is caller-scoped), minus
            // soft-deleted tombstones.
            const [{ listLiveMembershipClubs }, { listMyLiveMiniLeagues }] = await Promise.all([
              import("@/live/features/membership"),
              import("@/live/features/miniLeagues"),
            ]);
            const [clubs, miniLeagues] = await Promise.all([
              listLiveMembershipClubs(ctx),
              listMyLiveMiniLeagues(ctx),
            ]);
            const clubIds = Array.from(new Set([
              ...clubs.filter((c) => !isLiveClubDeleted(c)).map((c) => c.id),
              ...miniLeagues.map((league: any) => league.club_id),
            ]));
            if (clubIds.length === 0) return [];
            return listLiveNewsMulti(ctx, clubIds);
          })();
          const rows = (posts as Array<Parameters<typeof liveNewsPostToRow>[0]>)
            .filter((p) => p.status === "published")
            .map(liveNewsPostToRow)
            .sort((a, b) => b.published_at.localeCompare(a.published_at))
            .slice(0, limit);
          writeHomeSectionSnapshot("club-news", snapshotScope, rows);
          return rows;
        },
      }, clubId ? { clubId } : { everyGroup: true, merge: (parts: ClubNewsRow[][]) => {
        const rows = [...new Map(parts.flat().map(row => [row.id, row])).values()].sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, limit);
        writeHomeSectionSnapshot("club-news", snapshotScope, rows);
        return rows;
      } });
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

export function useClubNewsPost(newsId?: string | null, clubIdHint?: string | null) {
  const { user } = useAuth();
  const isIcp = isFeatureRoutedToIcp("news");
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  const queryClient = useQueryClient();
  // Only fresh fetched feed data for this caller/provider seeds a detail.
  // Persisted placeholders and legacy caches remain routing hints only.
  const freshFeed = queryClient.getQueryCache().findAll({ queryKey: ["club-news"] })
    .filter((query) => query.queryKey[3] === user?.id && query.queryKey[4] === isIcp &&
      !query.state.isInvalidated && query.state.status === "success" &&
      Date.now() - query.state.dataUpdatedAt < NEWS_POST_FRESH_MS)
    .map((query) => ({ post: (query.state.data as ClubNewsRow[] | undefined)?.find((row) => row.id === newsId), updatedAt: query.state.dataUpdatedAt }))
    .find((entry) => entry.post);
  return useQuery<ClubNewsRow | null>({
    queryKey: newsPostKey(newsId, user?.id, isIcp),
    queryFn: async () => {
      if (!newsId) return null;
      if (useIcpLab) return getLocalLabNewsPost(newsId) as ClubNewsRow | null;
      // Home/archive already know the actual post's club, and share tokens may
      // carry one ([news:clubId:newsId]). Use either as a routing hint, not as
      // authorization: the owning canister still checks the audience.
      const knownPost = queryClient.getQueriesData<ClubNewsRow[]>({ queryKey: ["club-news"] })
        .flatMap(([, rows]) => rows ?? [])
        .find((row) => row.id === newsId);
      const routeClubId = knownPost?.club_id ?? clubIdHint ?? null;
      return withFeatureBackend("news", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("club_news")
            .select(NEWS_COLUMNS)
            .eq("id", newsId)
            .maybeSingle();
          if (error) throw error;
          return (data as ClubNewsRow | null) ?? null;
        },
        icp: async (ctx) => {
          if (routeClubId) {
            const posts = await listLiveNews(ctx, routeClubId);
            const post = posts.find((row) => row.id === newsId);
            return post ? liveNewsPostToRow(post) : null;
          }
          // Cold deep links retain caller-authorized owner discovery. Competition
          // audiences may be visible without an ordinary club membership.
          const [{ listLiveMembershipClubs }, { listMyLiveMiniLeagues }] = await Promise.all([
            import("@/live/features/membership"),
            import("@/live/features/miniLeagues"),
          ]);
          const [clubs, miniLeagues] = await Promise.all([
            listLiveMembershipClubs(ctx),
            listMyLiveMiniLeagues(ctx),
          ]);
          const clubIds = Array.from(new Set([
            ...clubs.filter((c) => !isLiveClubDeleted(c)).map((c) => c.id),
            ...miniLeagues.map((league: any) => league.club_id),
          ]));
          const posts = await listLiveNewsMulti(ctx, clubIds);
          const post = (posts as Array<Parameters<typeof liveNewsPostToRow>[0]>)
            .find((p) => p.id === newsId);
          return post ? liveNewsPostToRow(post) : null;
        },
      }, routeClubId ? { clubId: routeClubId } : { newsId });
    },
    enabled: !!user && !!newsId,
    initialData: freshFeed?.post,
    initialDataUpdatedAt: freshFeed?.updatedAt,
    staleTime: NEWS_POST_FRESH_MS,
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
          return clubs
            .filter(c => adminClubIds.includes(c.id) && !isLiveClubDeleted(c))
            .map(c => ({ id: c.id, name: c.name }));
        }
      }, { everyGroup: true, merge: mergeLists });
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
      }, { clubId: clubId! });
    },
    enabled: !!clubId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClubMiniLeaguesForNews(clubId?: string | null) {
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["club-mini-leagues-for-news", clubId],
    queryFn: async () => {
      if (useIcpLab || !clubId) return [];
      return withFeatureBackend("mini_leagues", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("mini_leagues")
            .select("id, name")
            .eq("club_id", clubId)
            .order("name");
          if (error) throw error;
          return (data ?? []) as Array<{ id: string; name: string }>;
        },
        icp: async (ctx) => {
          const { listLiveMiniLeaguesByClub } = await import("@/live/features/miniLeagues");
          const leagues = await listLiveMiniLeaguesByClub(ctx, clubId);
          return leagues.filter((league: any) => league.status === "active").map((league: any) => ({ id: league.id, name: league.name }));
        },
      }, { clubId });
    },
    enabled: !!clubId,
    staleTime: 5 * 60 * 1000,
  });
}

export interface NewsCompetitionOption {
  id: string;
  name: string;
  organizer_club_id: string;
}

export function useNewsPublishableCompetitions() {
  const { user } = useAuth();
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  return useQuery<NewsCompetitionOption[]>({
    queryKey: ["news-publishable-competitions", user?.id],
    queryFn: async () => {
      if (useIcpLab) return [];
      return withFeatureBackend("competitions", {
        supabase: async () => {
          const [roleResult, clubRoleResult] = await Promise.all([
            supabase.from("competition_roles")
              .select("competition_id")
              .eq("user_id", user!.id)
              .in("role", ["competition_admin", "admin", "owner"]),
            supabase.from("user_roles")
              .select("club_id")
              .eq("user_id", user!.id)
              .eq("role", "club_admin"),
          ]);
          if (roleResult.error) throw roleResult.error;
          if (clubRoleResult.error) throw clubRoleResult.error;
          const roleIds = (roleResult.data ?? []).map((row) => row.competition_id);
          const clubIds = (clubRoleResult.data ?? []).map((row) => row.club_id).filter(Boolean) as string[];
          let query = supabase
            .from("competitions")
            .select("id, name, organizer_club_id")
            .order("name");
          if (roleIds.length && clubIds.length) {
            query = query.or(`id.in.(${roleIds.join(",")}),organizer_club_id.in.(${clubIds.join(",")})`);
          } else if (roleIds.length) {
            query = query.in("id", roleIds);
          } else if (clubIds.length) {
            query = query.in("organizer_club_id", clubIds);
          } else {
            return [];
          }
          const { data, error } = await query;
          if (error) throw error;
          return (data ?? []) as NewsCompetitionOption[];
        },
        icp: async (ctx) => {
          const [{ getLiveMyRoleGrants }, { listLiveCompetitionsMulti, listLiveMyNewsCompetitions }, { listLiveMembershipClubs }] = await Promise.all([
            import("@/live/features/membership"),
            import("@/live/features/competitions"),
            import("@/live/features/membership"),
          ]);
          const grants = await getLiveMyRoleGrants(ctx);
          const clubIds = Array.from(new Set(
            grants.filter((grant: any) => grant.role === "club_admin").flatMap((grant: any) => grant.club),
          ));
          const [managed, clubs] = await Promise.all([
            listLiveMyNewsCompetitions(ctx),
            listLiveMembershipClubs(ctx),
          ]);
          const clubAdminCompetitions = clubIds.length
            ? await listLiveCompetitionsMulti(ctx, clubIds)
            : [];
          const allowedIds = new Set([...managed, ...clubAdminCompetitions].map((item: any) => item.id));
          return [...new Map(
            [...managed, ...clubAdminCompetitions]
              .filter((item: any) => allowedIds.has(item.id))
              .map((item: any) => [item.id, {
                id: item.id,
                name: item.name,
                organizer_club_id: item.organizer_club_id ?? item.club_id,
              }]),
          ).values()].filter((item) => clubs.length === 0 || clubIds.includes(item.organizer_club_id) || managed.some((entry: any) => entry.id === item.id));
        },
      }, acrossLists);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Resolve team names directly by id. Used by News audience labels so we can
 * always name the targeted teams, even before/without the club team list
 * (e.g. an article opened by deep link before `club_id` teams have loaded).
 */
export function useTeamNamesByIds(teamIds?: string[] | null, clubIdHint?: string | null) {
  const ids = Array.from(new Set((teamIds || []).filter(Boolean)));
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["news-team-names", ids.slice().sort().join(","), clubIdHint ?? null],
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
          return teams.flatMap(t => t[0] ? [{ id: t[0].id, name: t[0].name }] : []);
        }
      }, clubIdHint ? { clubId: clubIdHint } : { everyGroup: true, merge: (parts) => [...new Map(parts.flat().map((row) => [row.id, row])).values()] });
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
