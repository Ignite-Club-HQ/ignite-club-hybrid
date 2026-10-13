import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveTeamRoleGrants } from "@/live/features/membership";
import { fanOutLiveNotifications } from "@/live/features/notifications";
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

    // ICP: team role grants (club_domain) stand in for user_roles/duties;
    // event-group (mini-league) match duties have no canister equivalent yet,
    // so only regular team boards notify under ICP.
    if (resolveAuthBackend() === "icp") {
      if (teamId.startsWith("event-group-")) return;
      try {
        await withFeatureBackend("membership", {
          supabase: async () => {},
          icp: async (ctx) => {
            const grants = await listLiveTeamRoleGrants(ctx, teamId);
            const recipientIds = new Set<string>([userId]);
            (grants as Array<{ role: string; account_id: string }>).forEach((grant) => {
              if ((grant.role === "coach" || grant.role === "team_admin") && grant.account_id) {
                recipientIds.add(grant.account_id);
              }
            });
            const recipientArray = Array.from(recipientIds);
            await fanOutLiveNotifications(ctx, {
              userIds: recipientArray,
              // clubId: this hook isn't passed the club id, so the team id is
              // used as the fan-out grouping key (teams are club-scoped anyway).
              clubId: teamId,
              kind: "formation_change",
              body: buildFormationNotificationMessage(changeType, detail, changeDetails),
              idempotencyKeyPrefix: `formation-${teamId}-${Date.now()}`,
              relatedId: teamId,
            });
          },
        });
      } catch (error) {
        console.error("Failed to send ICP formation change notification:", error);
      }
      return;
    }

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
