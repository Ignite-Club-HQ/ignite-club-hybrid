import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { savePitchState } from "../pitchStateUtils";
import { buildEventLineupSnapshot, lineupSignature, saveEventLineup } from "../eventLineupRepository";
import type { Player, TeamSize, SubstitutionEvent, Goal } from "../types";

interface UsePitchBoardPersistenceArgs {
  hasInitialized: boolean;
  teamId: string;
  userId: string | undefined;
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  ballPosition: { x: number; y: number };
  autoSubPlan: SubstitutionEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
  mockMode: boolean;
  linkedEventId: string | null;
  goals: Goal[];
  isEventGroup: boolean;
  forceEventGroupSync: () => void;
  touchDragPlayer: unknown;
  draggedPlayer: unknown;
  readOnly?: boolean;
}

/**
 * Step 9c — Persistence effects for PitchBoard.
 *
 * 1) Debounced `savePitchState` writer to localStorage (300ms during active
 *    drag, immediate otherwise) + event-group DB sync trigger.
 * 2) `active_games.pitch_state` mirror for the auto-sub plan so unlinked
 *    boards still feed GlobalSubMonitor's cron `pending_sub` push.
 */
export function usePitchBoardPersistence({
  hasInitialized,
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
  linkedEventId,
  goals,
  isEventGroup,
  forceEventGroupSync,
  touchDragPlayer,
  draggedPlayer,
  readOnly = false,
}: UsePitchBoardPersistenceArgs) {
  // Save pitch state to localStorage whenever it changes (only after
  // initialization). Debounced to avoid excessive saves during drag.
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!hasInitialized) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const isActiveDrag = touchDragPlayer !== null || draggedPlayer !== null;
    const delay = isActiveDrag ? 300 : 0;

    saveTimeoutRef.current = setTimeout(() => {
      savePitchState(teamId, {
        players,
        teamSize,
        selectedFormation,
        ballPosition,
        autoSubPlan,
        autoSubActive,
        autoSubPaused,
        mockMode,
        linkedEventId,
        goals,
      });

      if (isEventGroup) {
        forceEventGroupSync();
      }
    }, delay);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    hasInitialized, teamId, players, teamSize, selectedFormation, ballPosition,
    autoSubPlan, autoSubActive, autoSubPaused, mockMode, linkedEventId, goals,
    isEventGroup, forceEventGroupSync, touchDragPlayer, draggedPlayer,
  ]);

  // Mirror auto-sub plan + roster into active_games.pitch_state whenever the
  // plan changes, regardless of whether the board is linked to an event.
  // GlobalSubMonitor's full sync is gated on `linkedEventId`, so without this
  // a coach who plans subs on an unlinked board would never get the cron
  // `pending_sub` push because `pitch_state.autoSubPlan` stays empty.
  const lastPlanSyncRef = useRef<string>("");
  useEffect(() => {
    if (!hasInitialized || !userId || !teamId || isEventGroup) return;
    if (!autoSubActive) return;

    const signature = JSON.stringify({
      n: autoSubPlan.length,
      a: autoSubActive,
      ids: autoSubPlan.map(s => `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}-${s.executed ? 1 : 0}`),
    });
    if (signature === lastPlanSyncRef.current) return;
    lastPlanSyncRef.current = signature;

    const t = setTimeout(() => {
      supabase
        .from("active_games")
        .update({
          pitch_state: {
            sport: "soccer",
            autoSubActive,
            autoSubPlan,
            players,
            linkedEventId,
          } as any,
          updated_at: new Date().toISOString(),
        })
        .eq("team_id", teamId)
        .eq("is_active", true)
        .then(({ error }) => {
          if (error) console.warn("[PitchBoard] auto-sub plan sync failed", error);
        });
    }, 800);
    return () => clearTimeout(t);
  }, [hasInitialized, userId, teamId, isEventGroup, autoSubActive, autoSubPlan, players, linkedEventId]);

  // Durable per-event lineup mirror (`event_lineups`). Unlike the localStorage
  // copy, this follows the coach to any device and survives cache clears.
  // Only the planned lineup is stored — never minutes, goals or the live plan.
  const lastLineupSigRef = useRef<string>("");
  useEffect(() => {
    if (!hasInitialized || readOnly || mockMode || isEventGroup) return;
    if (!linkedEventId || !teamId) return;
    if (!players.some((p) => p.position !== null)) return;

    const snapshot = buildEventLineupSnapshot({
      players,
      teamSize,
      selectedFormation,
      ballPosition,
    });
    const signature = `${linkedEventId}|${lineupSignature(snapshot)}`;
    if (signature === lastLineupSigRef.current) return;

    const t = setTimeout(() => {
      lastLineupSigRef.current = signature;
      void saveEventLineup({ eventId: linkedEventId, teamId, userId, snapshot });
    }, 1200);
    return () => clearTimeout(t);
  }, [
    hasInitialized, readOnly, mockMode, isEventGroup, linkedEventId, teamId,
    userId, players, teamSize, selectedFormation, ballPosition,
  ]);
}
