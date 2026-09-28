import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import type { Player, SubstitutionEvent, TeamSize } from "../types";
import type { PitchPosition } from "../PositionBadge";
import { useRemoteFillInSync } from "@/hooks/useRemoteFillInSync";
import { recalculateRemainingPlanTeamAware as recalculateRemainingPlan } from "../pitchStateUtils";

type Toast = (args: { title: string; description?: string; variant?: "destructive" }) => void;

interface GameTimerLike {
  getMinutesPerHalf: () => number;
  getElapsedSeconds: () => number;
  getCurrentHalf: () => 1 | 2;
}

interface UsePitchBoardFillInArgs {
  readOnly: boolean;
  teamId: string | null | undefined;
  players: Player[];
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  autoSubPlan: SubstitutionEvent[];
  setAutoSubPlan: Dispatch<SetStateAction<SubstitutionEvent[]>>;
  autoSubActive: boolean;
  handleCancelAutoSubPlan: () => void;
  teamSize: TeamSize;
  rotateGkAtHalftime: boolean;
  gameTimerRef: MutableRefObject<{
    getMinutesPerHalf?: () => number;
    getElapsedSeconds?: () => number;
    getCurrentHalf?: () => 1 | 2;
  } | null>;
  toast: Toast;
}

/**
 * Owns fill-in player state for the pitch board:
 * - `fillInDialogOpen` state for the AddFillInPlayerDialog modal
 * - `handleAddFillInPlayer` / `handleRemoveFillInPlayer` mutation callbacks
 * - `existingJerseyNumbers` memo for the dialog's auto-suggest
 * - Shared-session remote fill-in merge effect (additions only) so that a
 *   fill-in added by one controller (admin) becomes visible to another
 *   controller (Subs Manager) on a different device.
 *
 * Sub plan recalculation when a fill-in is added or removed mid-plan is
 * preserved here — never blanket-regenerate, only repair the remaining plan.
 */
export function usePitchBoardFillIn({
  readOnly,
  teamId,
  players,
  setPlayers,
  autoSubPlan,
  setAutoSubPlan,
  autoSubActive,
  handleCancelAutoSubPlan,
  teamSize,
  rotateGkAtHalftime,
  gameTimerRef,
  toast,
}: UsePitchBoardFillInArgs) {
  const [fillInDialogOpen, setFillInDialogOpen] = useState(false);

  // Shared-session fill-in sync (additions only).
  const remoteFillIns = useRemoteFillInSync(teamId, !readOnly);
  useEffect(() => {
    if (readOnly) return;
    if (!remoteFillIns || remoteFillIns.length === 0) return;
    setPlayers(prev => {
      const knownIds = new Set(prev.map(p => p.id));
      const additions = remoteFillIns.filter(p => !knownIds.has(p.id));
      if (additions.length === 0) return prev;
      const normalised = additions.map(p => ({
        ...p,
        position: null,
        currentPitchPosition: undefined,
        isFillIn: true,
      }));
      return [...prev, ...normalised];
    });
  }, [remoteFillIns, readOnly, setPlayers]);

  const handleAddFillInPlayer = useCallback(
    (playerData: { name: string; number?: number; positions: PitchPosition[] }) => {
      if (readOnly) return;

      const fillInId = `fill-in-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newPlayer: Player = {
        id: fillInId,
        name: playerData.name,
        number: playerData.number,
        position: null,
        assignedPositions: playerData.positions,
        currentPitchPosition: undefined,
        minutesPlayed: 0,
        isFillIn: true,
      };

      setPlayers(prev => [...prev, newPlayer]);
      toast({
        title: "Fill-in player added",
        description: `${playerData.name} has been added to the bench`,
      });

      if (autoSubPlan.some(s => !s.executed)) {
        const minutesPerHalfSecs = (gameTimerRef.current?.getMinutesPerHalf?.() || 10) * 60;
        const currentElapsed = gameTimerRef.current?.getElapsedSeconds?.() || 0;
        const currentHalf = gameTimerRef.current?.getCurrentHalf?.() || 1;

        const updatedPlayers = [...players, newPlayer];
        const executedSubs = autoSubPlan.filter(s => s.executed);
        const remainingSubs = autoSubPlan.filter(s => !s.executed);
        const anchor = remainingSubs[0];

        const recalculated = recalculateRemainingPlan(
          updatedPlayers,
          parseInt(teamSize),
          minutesPerHalfSecs,
          currentElapsed,
          currentHalf,
          anchor,
          rotateGkAtHalftime
        );

        const finalPlan = recalculated.length > 0
          ? [...executedSubs, ...recalculated]
          : [...executedSubs, ...remainingSubs];
        setAutoSubPlan(finalPlan);
        toast({
          title: "Sub plan updated",
          description: "Auto-substitution plan recalculated for new fill-in",
        });
      }
    },
    [readOnly, toast, players, autoSubPlan, teamSize, rotateGkAtHalftime, setPlayers, setAutoSubPlan, gameTimerRef]
  );

  const handleRemoveFillInPlayer = useCallback(
    (playerId: string) => {
      if (readOnly) return;

      const player = players.find(p => p.id === playerId);
      if (!player?.isFillIn) return;

      if (player.position !== null) {
        toast({
          title: "Cannot remove",
          description: "Move the player to the bench first before removing",
          variant: "destructive",
        });
        return;
      }

      setPlayers(prev => prev.filter(p => p.id !== playerId));

      const referencedInPlan = autoSubPlan.some(
        sub => sub.playerIn.id === playerId || sub.playerOut.id === playerId
      );
      if (autoSubActive && referencedInPlan) {
        handleCancelAutoSubPlan();
        toast({
          title: "Auto-subs cancelled",
          description: `${player.name} was in the plan — auto-subs have been cancelled`,
        });
      } else {
        toast({
          title: "Fill-in player removed",
          description: `${player.name} has been removed`,
        });
      }
    },
    [readOnly, players, toast, autoSubPlan, autoSubActive, handleCancelAutoSubPlan, setPlayers]
  );

  const existingJerseyNumbers = useMemo(
    () => players.map(p => p.number).filter((n): n is number => n !== undefined),
    [players]
  );

  return {
    fillInDialogOpen,
    setFillInDialogOpen,
    handleAddFillInPlayer,
    handleRemoveFillInPlayer,
    existingJerseyNumbers,
  };
}
