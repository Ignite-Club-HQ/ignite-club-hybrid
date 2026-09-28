import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type EventCancellationRecipientScope = {
  open: boolean;
  teamId: string | null;
  clubId: string;
  miniLeagueId?: string | null;
};

export function useEventCancellationRecipients({
  open,
  teamId,
  clubId,
  miniLeagueId,
}: EventCancellationRecipientScope) {
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [recipientLookupFailed, setRecipientLookupFailed] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!open) {
      requestIdRef.current++;
      return;
    }

    const requestId = ++requestIdRef.current;
    void fetchMemberCount(requestId);

    async function fetchMemberCount(reqId: number): Promise<void> {
      setIsLoading(true);
      setRecipientLookupFailed(false);
      const isCurrent = () => requestIdRef.current === reqId;

      try {
        if (miniLeagueId) {
          const { data: league, error: leagueError } = await supabase
            .from("mini_leagues")
            .select("club_id")
            .eq("id", miniLeagueId)
            .maybeSingle();
          if (leagueError) throw leagueError;

          if (!league) {
            throw new Error("Mini league not found");
          }

          const { data: playersData, error: playersError } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", miniLeagueId)
            .not("parent_user_id", "is", null);
          if (playersError) throw playersError;

          const parentIds = [
            ...new Set(
              (playersData?.map(player => player.parent_user_id).filter(Boolean) as string[]) || [],
            ),
          ];

          const { data: adminRoles, error: adminError } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin", "coach"]);
          if (adminError) throw adminError;

          const adminIds = adminRoles?.map(role => role.user_id) || [];
          const allUserIds = [...new Set([...parentIds, ...adminIds])];
          if (!isCurrent()) return;
          setMemberCount(allUserIds.length);
        } else {
          let memberQuery = supabase.from("user_roles").select("user_id");
          if (teamId) {
            memberQuery = memberQuery.eq("team_id", teamId);
          } else {
            memberQuery = memberQuery.eq("club_id", clubId);
          }

          const { data: members, error: membersError } = await memberQuery;
          if (membersError) throw membersError;
          const uniqueMembers = [...new Set(members?.map(member => member.user_id) || [])];
          if (!isCurrent()) return;
          setMemberCount(uniqueMembers.length);
        }
      } catch (error) {
        console.error("Failed to fetch member count:", error);
        if (!isCurrent()) return;
        setMemberCount(null);
        setRecipientLookupFailed(true);
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
    }
  }, [open, teamId, clubId, miniLeagueId]);

  return { memberCount, isLoading, recipientLookupFailed };
}
