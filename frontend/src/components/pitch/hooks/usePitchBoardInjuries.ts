import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Player } from "../types";

interface UsePitchBoardInjuriesArgs {
  readOnly: boolean;
  players: Player[];
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  pushToUndoHistory: (description: string, players: Player[]) => void;
  recalcPlanForInjury: (
    players: Player[],
    injuredPlayerId: string,
    replacementPlayerId?: string,
  ) => void;
  toast: (options: { title: string; description?: string }) => void;
}

export function usePitchBoardInjuries({
  readOnly,
  players,
  setPlayers,
  pushToUndoHistory,
  recalcPlanForInjury,
  toast,
}: UsePitchBoardInjuriesArgs) {
  const togglePlayerInjury = useCallback((playerId: string) => {
    if (readOnly) return;
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) =>
        player.id === playerId
          ? { ...player, isInjured: !player.isInjured }
          : player,
      ),
    );
    const player = players.find((candidate) => candidate.id === playerId);
    const isNowInjured = !player?.isInjured;
    toast({
      title: isNowInjured ? "Player marked as injured" : "Player marked as fit",
      description: `${player?.name} ${
        isNowInjured
          ? "will not be available for substitutions"
          : "is now available for substitutions"
      }`,
    });
    if (isNowInjured) {
      recalcPlanForInjury(
        players.map((candidate) =>
          candidate.id === playerId ? { ...candidate, isInjured: true } : candidate,
        ),
        playerId,
      );
    }
  }, [players, readOnly, recalcPlanForInjury, setPlayers, toast]);

  const handleMarkInjuredOnPitch = useCallback((
    playerId: string,
    replacementId?: string,
  ) => {
    if (readOnly) return;
    const injuredPlayer = players.find((player) => player.id === playerId);
    if (!injuredPlayer || injuredPlayer.position === null) return;
    const replacement = replacementId
      ? players.find((player) => player.id === replacementId)
      : null;
    const injuredPosition = injuredPlayer.position;
    const injuredPitchPosition = injuredPlayer.currentPitchPosition;

    pushToUndoHistory("Injury sub off", players);
    const updatedPlayers = players.map((player) => {
      if (player.id === playerId) {
        return {
          ...player,
          position: null,
          currentPitchPosition: undefined,
          isInjured: true,
        };
      }
      if (replacement && player.id === replacement.id) {
        return {
          ...player,
          position: injuredPosition,
          currentPitchPosition: injuredPitchPosition,
        };
      }
      return player;
    });
    setPlayers(updatedPlayers);
    toast(
      replacement
        ? {
            title: "Injury substitution made",
            description: `${injuredPlayer.name} injured → ${replacement.name} subbed on`,
          }
        : {
            title: "Player injured & subbed off",
            description: `${injuredPlayer.name} moved to bench (no bench players available to replace)`,
          },
    );
    recalcPlanForInjury(updatedPlayers, playerId, replacement?.id);
  }, [players, pushToUndoHistory, readOnly, recalcPlanForInjury, setPlayers, toast]);

  return { togglePlayerInjury, handleMarkInjuredOnPitch };
}
