import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveCompetitions } from "@/live/features/competitions";
import { listLiveMiniLeaguesByClub } from "@/live/features/miniLeagues";

type Option = { id: string; name: string };

/** Competitions and mini leagues a club can address news to. */
export function useNewsAudienceTargets(clubId: string | null) {
  return useQuery<{ competitions: Option[]; miniLeagues: Option[] }>({
    queryKey: ["news-audience-targets", clubId],
    enabled: !!clubId,
    queryFn: async () => {
      const safe = async <T,>(fn: () => Promise<T[]>) => {
        try {
          return await fn();
        } catch (e) {
          console.warn("[ClubNews] audience targets failed", e);
          return [] as T[];
        }
      };
      const competitions = await safe<Option>(() =>
        withFeatureBackend("competitions", {
          supabase: async () => {
            const { data: ids } = await supabase.rpc("club_news_competition_ids", { _club_id: clubId! });
            const list = ((ids ?? []) as unknown as string[]).filter(Boolean);
            if (list.length === 0) return [];
            const { data } = await supabase.from("competitions").select("id, name").in("id", list).order("name");
            return (data ?? []) as Option[];
          },
          icp: async (ctx) =>
            ((await listLiveCompetitions(ctx, clubId!)) as Array<{ id: string; name: string }>).map((c) => ({
              id: c.id,
              name: c.name,
            })),
        }),
      );
      const miniLeagues = await safe<Option>(() =>
        withFeatureBackend("mini_leagues", {
          supabase: async () => {
            const { data } = await supabase.from("mini_leagues").select("id, name").eq("club_id", clubId!).order("name");
            return (data ?? []) as Option[];
          },
          icp: async (ctx) =>
            ((await listLiveMiniLeaguesByClub(ctx, clubId!)) as Array<{ id: string; name: string }>).map((m) => ({
              id: m.id,
              name: m.name,
            })),
        }),
      );
      return { competitions, miniLeagues };
    },
  });
}
