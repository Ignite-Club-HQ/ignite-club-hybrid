import { Fragment, type MutableRefObject, type SetStateAction, type Dispatch, type TouchEvent } from "react";
import PlayerToken from "./PlayerToken";
import type { MiniLeagueTeams, Player } from "./types";
import type { PitchPosition } from "./PositionBadge";

export interface BenchPlayerFilterInput {
  players: Player[];
  miniLeagueTeams?: MiniLeagueTeams | null;
  selectedTeam: "a" | "b" | "both";
  subMode: boolean;
  selectedOnPitch: string | null;
  validBenchPlayerIds: Set<string>;
  positionFilter: PitchPosition | null;
}

export function filterBenchPlayers({
  players,
  miniLeagueTeams,
  selectedTeam,
  subMode,
  selectedOnPitch,
  validBenchPlayerIds,
  positionFilter,
}: BenchPlayerFilterInput): Player[] {
  return players.filter((player) => {
    if (miniLeagueTeams && selectedTeam !== "both" && player.teamSide !== selectedTeam) {
      return false;
    }
    if (subMode && selectedOnPitch) {
      return validBenchPlayerIds.has(player.id);
    }
    return !positionFilter
      || player.assignedPositions?.includes(positionFilter)
      || !player.assignedPositions?.length;
  });
}

interface BenchPlayersProps {
  players: Player[];
  playersOnPitch: Player[];
  miniLeagueTeams?: MiniLeagueTeams | null;
  selectedTeam: "a" | "b" | "both";
  subMode: boolean;
  swapMode: boolean;
  selectedOnPitch: string | null;
  selectedOnBench: string | null;
  validBenchPlayerIds: Set<string>;
  positionFilter: PitchPosition | null;
  readOnly: boolean;
  gameInProgress: boolean;
  lastTapRef: MutableRefObject<{ playerId: string; time: number } | null>;
  touchHandledRef: MutableRefObject<boolean>;
  benchLongPressTimer: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setBenchInjuryTarget: Dispatch<SetStateAction<string | null>>;
  setBenchInjuryConfirmOpen: Dispatch<SetStateAction<boolean>>;
  onBenchLongPressStart: (playerId: string, event: TouchEvent) => void;
  onBenchLongPressMove: (event: TouchEvent) => void;
  onBenchLongPressEnd: (event: TouchEvent) => void;
  onDragStart: (playerId: string) => void;
  onDragEnd: () => void;
  onPlayerClick: (playerId: string, fromBench: boolean) => void;
  onOpenBenchToSub: (playerId: string) => void;
  onRemoveFillInPlayer: (playerId: string) => void;
  getPlayerTeamColor: (player: Player) => string | undefined;
  nextSubInfo: { playerInId: string; countdown: string } | null;
  subAnimationOut: string | null;
  subDuePlayerIds: Set<string>;
  isDragging: (player: Player) => boolean;
  wrapperClassName?: string;
  emptyMessage: string;
  emptyMessageClassName: string;
  noValidPlayerMessage: string;
  noValidPlayerMessageClassName: string;
}

export function PitchBoardBenchPlayers({
  players,
  playersOnPitch,
  miniLeagueTeams,
  selectedTeam,
  subMode,
  swapMode,
  selectedOnPitch,
  selectedOnBench,
  validBenchPlayerIds,
  positionFilter,
  readOnly,
  gameInProgress,
  lastTapRef,
  touchHandledRef,
  benchLongPressTimer,
  setBenchInjuryTarget,
  setBenchInjuryConfirmOpen,
  onBenchLongPressStart,
  onBenchLongPressMove,
  onBenchLongPressEnd,
  onDragStart,
  onDragEnd,
  onPlayerClick,
  onOpenBenchToSub,
  onRemoveFillInPlayer,
  getPlayerTeamColor,
  nextSubInfo,
  subAnimationOut,
  subDuePlayerIds,
  isDragging,
  wrapperClassName,
  emptyMessage,
  emptyMessageClassName,
  noValidPlayerMessage,
  noValidPlayerMessageClassName,
}: BenchPlayersProps) {
  const filteredPlayers = filterBenchPlayers({
    players,
    miniLeagueTeams,
    selectedTeam,
    subMode,
    selectedOnPitch,
    validBenchPlayerIds,
    positionFilter,
  });

  return (
    <>
      {players.length === 0 && (
        <p className={emptyMessageClassName}>{emptyMessage}</p>
      )}
      {subMode && selectedOnPitch && validBenchPlayerIds.size === 0 && players.length > 0 && (
        <p className={noValidPlayerMessageClassName}>{noValidPlayerMessage}</p>
      )}
      {filteredPlayers.map((player) => {
        const token = (
          <PlayerToken
            player={player}
            onDragStart={() => !readOnly && onDragStart(player.id)}
            onDragEnd={onDragEnd}
            onTouchStart={(event) => {
              if (readOnly) return;
              touchHandledRef.current = true;
              if (subMode || swapMode) return;
              const now = Date.now();
              const last = lastTapRef.current;
              if (last && last.playerId === player.id && now - last.time < 400) {
                lastTapRef.current = null;
                event.preventDefault();
                if (benchLongPressTimer.current) {
                  clearTimeout(benchLongPressTimer.current);
                  benchLongPressTimer.current = null;
                }
                setBenchInjuryTarget(player.id);
                setBenchInjuryConfirmOpen(true);
              } else {
                lastTapRef.current = { playerId: player.id, time: now };
                onBenchLongPressStart(player.id, event);
              }
            }}
            onClick={
              !readOnly && subMode && !player.isInjured
                ? () => {
                    if (touchHandledRef.current) {
                      touchHandledRef.current = false;
                      return;
                    }
                    onPlayerClick(player.id, false);
                  }
                : !readOnly && !subMode && !swapMode
                  ? () => {
                      if (touchHandledRef.current) {
                        touchHandledRef.current = false;
                        return;
                      }
                      const now = Date.now();
                      const last = lastTapRef.current;
                      if (last && last.playerId === player.id && now - last.time < 400) {
                        lastTapRef.current = null;
                        setBenchInjuryTarget(player.id);
                        setBenchInjuryConfirmOpen(true);
                      } else {
                        lastTapRef.current = { playerId: player.id, time: now };
                        if (gameInProgress && !player.isInjured && playersOnPitch.length > 0) {
                          onOpenBenchToSub(player.id);
                        }
                      }
                    }
                  : undefined
            }
            onInjuryToggle={undefined}
            onRemoveFillIn={!subMode && !swapMode && player.isFillIn
              ? () => onRemoveFillInPlayer(player.id)
              : undefined}
            isDragging={isDragging(player)}
            isSelected={subMode && selectedOnBench === player.id}
            isSubTarget={subMode && selectedOnPitch !== null && selectedOnBench !== player.id && !player.isInjured}
            subAnimation={subAnimationOut === player.id ? "out" : null}
            variant="bench"
            readOnly={readOnly}
            teamColor={getPlayerTeamColor(player)}
            isNextSub={nextSubInfo?.playerInId === player.id}
            nextSubCountdown={nextSubInfo?.playerInId === player.id ? nextSubInfo.countdown : null}
            isSubDue={subDuePlayerIds.has(player.id)}
          />
        );

        return wrapperClassName ? (
          <div key={player.id} className={wrapperClassName}>{token}</div>
        ) : (
          <Fragment key={player.id}>{token}</Fragment>
        );
      })}
    </>
  );
}
