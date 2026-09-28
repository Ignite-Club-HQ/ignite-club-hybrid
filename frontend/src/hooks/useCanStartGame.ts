import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface EventLike {
  id: string;
  type: string;
  team_id: string | null;
  event_date: string;
  is_cancelled?: boolean;
  is_bye?: boolean;
}

export type StartGamePhase = "future" | "imminent" | "live" | "past";

/**
 * Resolves whether the current user can start the pitch board game for this
 * event from a surface outside the event detail page (e.g. home Next Up
 * widget). Mirrors the gating used on EventDetailPage:
 *   • event must be a game, not cancelled, not a bye
 *   • user is team_admin / coach for the team OR the event's Subs Manager
 *   • imminent window: ≤120 min before kickoff
 *   • live window: kickoff … +180 min
 */
export function useCanStartGame(event: EventLike | null | undefined) {
  const { user } = useAuth();
  const eligibleType = event?.type === "game";

  const { data: hasRole } = useQuery({
    queryKey: ["can-start-game", "role", event?.id, event?.team_id, user?.id],
    queryFn: async () => {
      if (!user || !event) return false;
      const [roleRes, dutyRes] = await Promise.all([
        event.team_id
          ? supabase
              .from("user_roles")
              .select("user_id")
              .eq("user_id", user.id)
              .eq("team_id", event.team_id)
              .in("role", ["team_admin", "coach"])
              .limit(1)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("duties")
          .select("id")
          .eq("event_id", event.id)
          .eq("name", "Subs Manager")
          .eq("assigned_to", user.id)
          .limit(1),
      ]);
      const hasTeamRole = !!(roleRes.data && roleRes.data.length > 0);
      const isSubsManager = !!(dutyRes.data && dutyRes.data.length > 0);
      return hasTeamRole || isSubsManager;
    },
    enabled: !!user && !!event && eligibleType && !event.is_cancelled && !event.is_bye,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  if (!event || !eligibleType || event.is_cancelled || event.is_bye || !hasRole) {
    return { canStart: false, phase: "future" as StartGamePhase };
  }

  const minutesUntilKickoff =
    (new Date(event.event_date).getTime() - Date.now()) / (1000 * 60);

  let phase: StartGamePhase = "future";
  if (minutesUntilKickoff <= -180) phase = "past";
  else if (minutesUntilKickoff <= 0) phase = "live";
  else if (minutesUntilKickoff <= 120) phase = "imminent";

  // Only show the home-widget CTA for imminent / live windows.
  const canStart = phase === "imminent" || phase === "live";
  return { canStart, phase };
}
