import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  enabledRoleListFromFlags,
  loadPitchNotifyFlags,
} from "@/components/pitch/pitchBoardNotifyFlags";


interface UsePitchBoardEventLinkArgs {
  initialLinkedEventId?: string | null;
  savedLinkedEventId?: string | null;
  teamId: string;
  teamName: string;
  userId: string | undefined;
}

/**
 * Owns the pitch board's link to a scheduled event:
 * - `linkedEventId` state (seeded from prop / saved game state)
 * - `handleLinkEvent` (with email notification fan-out to coaches/admins/duty holders)
 * - linked event details query (for opponent name + auto-expiry)
 * - auto-unlink 24h after kickoff
 * - derived `opponentName`
 *
 * `setLinkedEventId` is exposed so the surrounding component (e.g. unlink flow
 * that needs to call `savePitchState` with the full game snapshot) can still
 * clear the link inline.
 */
export function usePitchBoardEventLink({
  initialLinkedEventId,
  savedLinkedEventId,
  teamId,
  teamName,
  userId,
}: UsePitchBoardEventLinkArgs) {
  const [linkedEventId, setLinkedEventId] = useState<string | null>(
    () => initialLinkedEventId || savedLinkedEventId || null
  );

  const handleLinkEvent = useCallback(
    async (eventId: string | null) => {
      const previousLinkedEventId = linkedEventId;
      setLinkedEventId(eventId);

      // Only send email notifications when linking (not unlinking) and event is different
      if (!eventId || eventId === previousLinkedEventId || !userId) return;

      try {
        const isEventGroup = teamId.startsWith("event-group-");
        let recipientUserIds: string[] = [];

        if (isEventGroup) {
          // Mini-league: notify Referee + Subs Manager of this specific match
          const groupId = teamId.replace("event-group-", "");
          const { data: matchDuties } = await supabase
            .from("event_group_duties")
            .select("assigned_to")
            .eq("group_id", groupId)
            .in("name", ["Referee", "Subs Manager"])
            .not("assigned_to", "is", null);

          recipientUserIds = (matchDuties || [])
            .map((d: any) => d.assigned_to as string)
            .filter((uid) => uid && uid !== userId);
        } else {
          // Honour per-team pitch-board notification role flags.
          const flags = await loadPitchNotifyFlags(teamId);
          const enabledRoles = enabledRoleListFromFlags(flags);
          const ids = new Set<string>();

          if (enabledRoles.length > 0) {
            const { data: teamAdmins } = await supabase
              .from("user_roles")
              .select("user_id")
              .eq("team_id", teamId)
              .in("role", enabledRoles);

            (teamAdmins || [])
              .map((r: any) => r.user_id as string)
              .filter((uid) => uid && uid !== userId)
              .forEach((uid) => ids.add(uid));
          }

          if (flags.subs_manager) {
            const { data: subsManagers } = await supabase
              .from("duties")
              .select("assigned_to")
              .eq("event_id", eventId)
              .eq("name", "Subs Manager")
              .not("assigned_to", "is", null);
            (subsManagers || []).forEach((d: any) => {
              if (d.assigned_to && d.assigned_to !== userId) ids.add(d.assigned_to as string);
            });
          }

          recipientUserIds = Array.from(ids);
        }

        if (recipientUserIds.length === 0) return;

        const { data: eventData } = await supabase

          .from("events")
          .select("title")
          .eq("id", eventId)
          .single();

        const eventTitle = eventData?.title || "a game";

        for (const recipientUserId of recipientUserIds) {
          supabase
            .rpc("send_pitch_board_notification_email_rpc", {
              _recipient_user_id: recipientUserId,
              _team_id: teamId,
              _team_name: teamName,
              _notification_type: "game_linked",
              _notification_message: `The pitch board has been linked to "${eventTitle}"`,
              _event_id: eventId,
            })
            .then((r: any) => {
              if (r?.error) console.error("[PitchBoard] Failed to send game linked email:", r.error);
            });
        }
      } catch (error) {
        console.error("[PitchBoard] Error sending game linked notifications:", error);
      }
    },
    [linkedEventId, teamId, teamName, userId]
  );

  // Fetch linked event details (for opponent name + expiry check)
  const { data: linkedEventDetails } = useQuery({
    queryKey: ["pitch-linked-event", linkedEventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, opponent, title, start_time")
        .eq("id", linkedEventId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!linkedEventId,
    // Always refetch when the board mounts/regains focus so edits made on
    // the event page (e.g. kickoff time changes) flow through immediately.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Auto-unlink the game 24h after kickoff so stale fixtures don't stay
  // attached to the pitch board indefinitely. Re-checks hourly while mounted.
  useEffect(() => {
    if (!linkedEventId || !linkedEventDetails?.start_time) return;
    const checkExpiry = () => {
      const kickoff = new Date(linkedEventDetails.start_time as string).getTime();
      if (!Number.isFinite(kickoff)) return;
      const ageMs = Date.now() - kickoff;
      if (ageMs > 24 * 60 * 60 * 1000) {
        setLinkedEventId(null);
      }
    };
    checkExpiry();
    const interval = setInterval(checkExpiry, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [linkedEventId, linkedEventDetails?.start_time]);

  // Extract opponent name from linked event
  const opponentName = useMemo(() => {
    if (linkedEventDetails?.opponent) return linkedEventDetails.opponent;
    if (linkedEventDetails?.title) {
      const vsMatch = linkedEventDetails.title.match(/\bvs?\b\s*(.+)/i);
      if (vsMatch) return vsMatch[1].trim();
    }
    return "Opponent";
  }, [linkedEventDetails]);

  return {
    linkedEventId,
    setLinkedEventId,
    handleLinkEvent,
    linkedEventDetails,
    opponentName,
  };
}
