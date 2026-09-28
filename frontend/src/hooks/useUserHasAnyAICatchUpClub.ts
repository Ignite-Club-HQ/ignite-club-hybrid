import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isAICatchUpAllowlisted } from "@/lib/aiCatchUpAllowlist";
import { useChatRecapGloballyEnabled } from "@/hooks/useChatRecapGloballyEnabled";

/**
 * Returns whether the current user belongs to at least one Pro (or Pro Football)
 * club that has AI Chat Recap enabled at the club level. Used to gate the
 * user-level AI Chat Recap toggle in Settings.
 */
export function useUserHasAnyAICatchUpClub(scopedClubId?: string | null) {
  const { user } = useAuth();
  const globallyEnabled = useChatRecapGloballyEnabled();

  const { data, isLoading, isFetching, isSuccess } = useQuery({
    queryKey: ["user-has-any-ai-catchup-club", user?.id, scopedClubId ?? "all"],
    enabled: !!user?.id && globallyEnabled && isAICatchUpAllowlisted(user?.id),
    staleTime: 60_000,
    // Retain previous result during refetch (e.g. after resume from inactivity)
    // so the PRO badge next to the AI button doesn't flash for Pro clubs while
    // the query revalidates.
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!isAICatchUpAllowlisted(user?.id)) return false;

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);

      if (!roles?.length) return false;



      const directClubIds = roles.filter((r) => r.club_id).map((r) => r.club_id!);
      const teamIds = roles.filter((r) => r.team_id).map((r) => r.team_id!);


      let teamClubIds: string[] = [];
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        teamClubIds = (teams ?? []).map((t: any) => t.club_id).filter(Boolean);
      }

      let allClubIds = Array.from(new Set([...directClubIds, ...teamClubIds]));
      if (scopedClubId) {
        allClubIds = allClubIds.includes(scopedClubId) ? [scopedClubId] : [scopedClubId];
      }
      if (allClubIds.length === 0) return false;

      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, ai_catch_up_enabled, club_subscriptions(is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at)")
        .in("id", allClubIds);

      return (clubs ?? []).some((c: any) => {
        const sub = Array.isArray(c.club_subscriptions) ? c.club_subscriptions[0] : c.club_subscriptions;
        if (!sub) return false;
        const isPro = sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override;
        const active = !sub.expires_at || new Date(sub.expires_at) > new Date();
        if (!isPro || !active) return false;
        return c.ai_catch_up_enabled === true;

      });
    },
  });

  // Personal opt-out (Settings > AI Chat Recap). Kept separate from club
  // eligibility so the Settings toggle stays visible after turning it off.
  const { data: userDisabled } = useQuery({
    queryKey: ["user-ai-catchup-pref", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("ai_catch_up_enabled")
        .eq("id", user!.id)
        .maybeSingle();
      return (data as any)?.ai_catch_up_enabled === false;
    },
  });

  // `resolved` is true only once the query has actually returned data at least
  // once. Consumers should hide Pro/upgrade affordances until resolved so the
  // badge doesn't flash for Pro users on resume/cold-render.
  const resolved = isSuccess && data !== undefined;
  if (!globallyEnabled) {
    return {
      hasAICatchUpClub: false,
      recapVisible: false,
      isLoading: false,
      isFetching: false,
      resolved: true,
    };
  }

  return {
    hasAICatchUpClub: !!data,
    recapVisible: !!data && userDisabled !== true,
    isLoading,
    isFetching,
    resolved,
  };
}

