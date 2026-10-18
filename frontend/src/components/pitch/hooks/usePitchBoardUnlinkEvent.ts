import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { savePitchState } from "../pitchStateUtils";
import type {
  Goal,
  Player,
  SubstitutionEvent,
  TeamSize,
} from "../types";

interface PitchBoardUnlinkEventArgs {
  teamId: string;
  userId?: string;
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  ballPosition: { x: number; y: number };
  autoSubPlan: SubstitutionEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
  mockMode: boolean;
  goals: Goal[];
  setLinkedEventId: (eventId: string | null) => void;
  onUnlinkEvent?: () => void;
  invalidateTeamActiveGame: () => void;
  notifyUnlinked: () => void;
}

export function usePitchBoardUnlinkEvent({
  teamId,
  userId,
  players,
  teamSize,
  selectedFormation,
  ballPosition,
  autoSubPlan,
  autoSubActive,
  autoSubPaused,
  mockMode,
  goals,
  setLinkedEventId,
  onUnlinkEvent,
  invalidateTeamActiveGame,
  notifyUnlinked,
}: PitchBoardUnlinkEventArgs) {
  return useCallback(async () => {
    setLinkedEventId(null);
    onUnlinkEvent?.();

    savePitchState(teamId, {
      players,
      teamSize,
      selectedFormation,
      ballPosition,
      autoSubPlan,
      autoSubActive,
      autoSubPaused,
      mockMode,
      linkedEventId: null,
      goals,
    });

    if (userId && !teamId.startsWith("event-group-")) {
      await withFeatureBackend("events", {
        supabase: async () => {
          await supabase
            .from("active_games")
            .update({ is_active: false })
            .eq("team_id", teamId)
            .eq("user_id", userId)
            .eq("is_active", true);
        },
        // Wired: events_domain.deactivate_active_game is the canister
        // counterpart of the active_games.is_active flip.
        icp: async (ctx) => {
          const { deactivateLiveActiveGame } = await import("@/live/features/events");
          await deactivateLiveActiveGame(ctx, teamId);
        },
      }, { teamId: teamId });
    }

    invalidateTeamActiveGame();
    notifyUnlinked();
  }, [
    autoSubActive,
    autoSubPaused,
    autoSubPlan,
    ballPosition,
    goals,
    invalidateTeamActiveGame,
    mockMode,
    notifyUnlinked,
    onUnlinkEvent,
    players,
    selectedFormation,
    setLinkedEventId,
    teamId,
    teamSize,
    userId,
  ]);
}
