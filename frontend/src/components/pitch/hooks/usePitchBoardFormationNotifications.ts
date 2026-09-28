import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Player } from "../types";
import type { PitchPosition } from "../PositionBadge";

export interface FormationChangeDetails {
  positionSwaps: Array<{
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
    fromX?: number;
    toX?: number;
  }>;
  benchMoves: Array<{
    player: Player;
    direction: "to-pitch" | "to-bench";
    position?: PitchPosition;
  }>;
}

export function buildFormationNotificationMessage(
  changeType: "formation" | "team_size",
  detail: string,
  changeDetails?: FormationChangeDetails,
): string {
  const changeParts: string[] = [];
  if (changeDetails) {
    const benchExits = changeDetails.benchMoves.filter((move) => move.direction === "to-bench");
    const pitchEntries = changeDetails.benchMoves.filter((move) => move.direction === "to-pitch");

    if (benchExits.length > 0) {
      changeParts.push(`📤 Off: ${benchExits.map((move) => move.player.name).join(", ")}`);
    }
    if (pitchEntries.length > 0) {
      changeParts.push(`📥 On: ${pitchEntries.map((move) => `${move.player.name} (${move.position || ""})`).join(", ")}`);
    }
    if (changeDetails.positionSwaps.length > 0) {
      changeParts.push(
        `🔄 Moved: ${changeDetails.positionSwaps
          .map((swap) => `${swap.player.name} ${swap.fromPosition}→${swap.toPosition}`)
          .join(", ")}`,
      );
    }
  }

  const baseSummary = changeType === "formation"
    ? `Formation changed to ${detail}`
    : `Team size changed to ${detail} players`;
  return changeParts.length > 0
    ? `${baseSummary} — ${changeParts.join(" • ")}`
    : baseSummary;
}

export function usePitchBoardFormationNotifications({
  userId,
  teamId,
  readOnly,
  linkedEventId,
  isGameFinished,
}: {
  userId?: string;
  teamId: string;
  readOnly: boolean;
  linkedEventId?: string | null;
  isGameFinished: () => boolean;
}) {
  return useCallback(async (
    changeType: "formation" | "team_size",
    detail: string,
    changeDetails?: FormationChangeDetails,
  ) => {
    if (!userId || readOnly || isGameFinished()) return;

    try {
      const recipientIds = new Set<string>([userId]);
      if (teamId.startsWith("event-group-")) {
        const groupId = teamId.replace("event-group-", "");
        const { data: matchDuties } = await supabase
          .from("event_group_duties")
          .select("assigned_to")
          .eq("group_id", groupId)
          .in("name", ["Referee", "Subs Manager"])
          .not("assigned_to", "is", null);
        matchDuties?.forEach((duty) => {
          if (duty.assigned_to) recipientIds.add(duty.assigned_to);
        });
      } else {
        const { data: staffRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("team_id", teamId)
          .in("role", ["coach", "team_admin"]);
        staffRoles?.forEach((role) => {
          if (role.user_id) recipientIds.add(role.user_id);
        });

        if (linkedEventId) {
          const { data: subsManagers } = await supabase
            .from("duties")
            .select("assigned_to")
            .eq("event_id", linkedEventId)
            .eq("name", "Subs Manager")
            .not("assigned_to", "is", null);
          subsManagers?.forEach((duty) => {
            if (duty.assigned_to) recipientIds.add(duty.assigned_to);
          });
        }
      }

      const recipientArray = Array.from(recipientIds);
      console.log("[Formation notify] Sending to", recipientArray.length, "recipients, teamId:", teamId);
      const { error } = await supabase.rpc("notify_formation_change", {
        _recipient_ids: recipientArray,
        _message: buildFormationNotificationMessage(changeType, detail, changeDetails),
        _related_id: teamId,
      });
      if (error) {
        console.error("Formation notification RPC error:", JSON.stringify(error));
      } else {
        console.log("[Formation notify] RPC success — notifications inserted");
      }
    } catch (error) {
      console.error("Failed to send formation change notification:", error);
    }
  }, [isGameFinished, linkedEventId, readOnly, teamId, userId]);
}
