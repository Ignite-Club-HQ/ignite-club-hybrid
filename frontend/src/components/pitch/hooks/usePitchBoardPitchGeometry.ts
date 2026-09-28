import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { getPositionFromCoords, type MiniLeagueTeams, type Player, type TeamSize } from "../types";
import type { PitchPosition } from "../PositionBadge";

type PitchPositionCoordinates = { x: number; y: number };

interface UsePitchBoardPitchGeometryArgs {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  playersRef: MutableRefObject<Player[]>;
  playerDragOffsetRef: MutableRefObject<PitchPositionCoordinates | null>;
  playerDragStartRef: MutableRefObject<{
    playerId: string;
    position: PitchPositionCoordinates;
    currentPitchPosition?: PitchPosition;
  } | null>;
  miniLeagueTeams?: MiniLeagueTeams;
  selectedTeamForSettings: "a" | "b" | "both";
  teamSize: TeamSize;
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  pushToUndoHistory: (description: string, players: Player[]) => void;
  flashSwapFeedback: (firstPlayerId: string, secondPlayerId: string) => void;
}

export function usePitchBoardPitchGeometry({
  containerRef,
  playersRef,
  playerDragOffsetRef,
  playerDragStartRef,
  miniLeagueTeams,
  selectedTeamForSettings,
  teamSize,
  setPlayers,
  pushToUndoHistory,
  flashSwapFeedback,
}: UsePitchBoardPitchGeometryArgs) {
  const clampPitchPosition = useCallback((x: number, y: number): PitchPositionCoordinates => ({
    x: Math.max(5, Math.min(95, x)),
    y: Math.max(5, Math.min(95, y)),
  }), []);

  const capturePlayerDragOffset = useCallback((playerId: string, clientX: number, clientY: number) => {
    if (!containerRef.current) {
      playerDragOffsetRef.current = null;
      return;
    }
    const player = playersRef.current.find((candidate) => candidate.id === playerId);
    if (!player?.position) {
      playerDragOffsetRef.current = null;
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    playerDragOffsetRef.current = {
      x: ((clientX - rect.left) / rect.width) * 100 - player.position.x,
      y: ((clientY - rect.top) / rect.height) * 100 - player.position.y,
    };
  }, [containerRef, playerDragOffsetRef, playersRef]);

  const getClientPitchPosition = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const offset = playerDragOffsetRef.current;
    return clampPitchPosition(
      ((clientX - rect.left) / rect.width) * 100 - (offset?.x ?? 0),
      ((clientY - rect.top) / rect.height) * 100 - (offset?.y ?? 0),
    );
  }, [clampPitchPosition, containerRef, playerDragOffsetRef]);

  const getClientPointFromPitchPosition = useCallback((position: PitchPositionCoordinates) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: rect.left + (position.x / 100) * rect.width,
      y: rect.top + (position.y / 100) * rect.height,
    };
  }, [containerRef]);

  const canTargetPlayer = useCallback((player: Player, excludedPlayerId?: string) => {
    if (!player.position || player.id === excludedPlayerId) return false;
    return !(
      miniLeagueTeams &&
      selectedTeamForSettings !== "both" &&
      player.teamSide !== selectedTeamForSettings
    );
  }, [miniLeagueTeams, selectedTeamForSettings]);

  const getPitchPlayerAtPoint = useCallback((clientX: number, clientY: number, excludedPlayerId?: string) => {
    const elements = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)].filter(Boolean) as Element[];
    for (const element of elements) {
      const token = (element as HTMLElement).closest?.(
        '[data-player-variant="pitch"][data-player-id]',
      ) as HTMLElement | null;
      const playerId = token?.getAttribute("data-player-id");
      if (playerId && playerId !== excludedPlayerId) return playerId;
    }

    let nearest: { id: string; distance: number } | null = null;
    document
      .querySelectorAll<HTMLElement>('[data-player-variant="pitch"][data-player-id]')
      .forEach((token) => {
        const playerId = token.getAttribute("data-player-id");
        const player = playerId
          ? playersRef.current.find((candidate) => candidate.id === playerId)
          : undefined;
        if (!player || !canTargetPlayer(player, excludedPlayerId)) return;
        const rect = token.getBoundingClientRect();
        const hitSlop = 24;
        if (
          clientX < rect.left - hitSlop ||
          clientX > rect.right + hitSlop ||
          clientY < rect.top - hitSlop ||
          clientY > rect.bottom + hitSlop
        ) {
          return;
        }
        const distance = Math.hypot(
          clientX - (rect.left + rect.width / 2),
          clientY - (rect.top + rect.height / 2),
        );
        if (!nearest || distance < nearest.distance) nearest = { id: player.id, distance };
      });
    if (nearest) return nearest.id;

    const pitchRect = containerRef.current?.getBoundingClientRect();
    if (pitchRect) {
      const hitRadius = Math.max(
        38,
        Math.min(58, Math.min(pitchRect.width, pitchRect.height) * 0.1),
      );
      playersRef.current.forEach((player) => {
        if (!canTargetPlayer(player, excludedPlayerId)) return;
        const distance = Math.hypot(
          clientX - (pitchRect.left + (player.position!.x / 100) * pitchRect.width),
          clientY - (pitchRect.top + (player.position!.y / 100) * pitchRect.height),
        );
        if (distance <= hitRadius && (!nearest || distance < nearest.distance)) {
          nearest = { id: player.id, distance };
        }
      });
    }
    return nearest?.id ?? null;
  }, [canTargetPlayer, containerRef, playersRef]);

  const getPitchPlayerOverlappingDragged = useCallback((draggedPlayerId: string, clientX: number, clientY: number) => {
    const draggedToken = Array.from(
      document.querySelectorAll<HTMLElement>('[data-player-variant="pitch"][data-player-id]'),
    ).find((token) => token.getAttribute("data-player-id") === draggedPlayerId);
    const draggedRect = draggedToken?.getBoundingClientRect();
    if (!draggedRect) return getPitchPlayerAtPoint(clientX, clientY, draggedPlayerId);

    const centerDistance = Math.hypot(
      clientX - (draggedRect.left + draggedRect.width / 2),
      clientY - (draggedRect.top + draggedRect.height / 2),
    );
    if (centerDistance > Math.max(draggedRect.width, draggedRect.height)) {
      return getPitchPlayerAtPoint(clientX, clientY, draggedPlayerId);
    }

    let best: { id: string; score: number } | null = null;
    document
      .querySelectorAll<HTMLElement>('[data-player-variant="pitch"][data-player-id]')
      .forEach((token) => {
        const playerId = token.getAttribute("data-player-id");
        const player = playerId
          ? playersRef.current.find((candidate) => candidate.id === playerId)
          : undefined;
        if (!player || !canTargetPlayer(player, draggedPlayerId)) return;
        const rect = token.getBoundingClientRect();
        const slop = 14;
        const overlapX = Math.max(
          0,
          Math.min(draggedRect.right, rect.right + slop) - Math.max(draggedRect.left, rect.left - slop),
        );
        const overlapY = Math.max(
          0,
          Math.min(draggedRect.bottom, rect.bottom + slop) - Math.max(draggedRect.top, rect.top - slop),
        );
        const overlapArea = overlapX * overlapY;
        if (overlapArea <= 0) return;
        const distance = Math.hypot(
          clientX - (rect.left + rect.width / 2),
          clientY - (rect.top + rect.height / 2),
        );
        const score = overlapArea - distance;
        if (!best || score > best.score) best = { id: player.id, score };
      });
    return best?.id ?? getPitchPlayerAtPoint(clientX, clientY, draggedPlayerId);
  }, [canTargetPlayer, getPitchPlayerAtPoint, playersRef]);

  const getDraggedPlayerPositionType = useCallback((player: Player, position: PitchPositionCoordinates) => {
    const y = miniLeagueTeams && player.teamSide === "b" ? 100 - position.y : position.y;
    return getPositionFromCoords(y, teamSize);
  }, [miniLeagueTeams, teamSize]);

  const updateDraggedPlayerPosition = useCallback((playerId: string, position: PitchPositionCoordinates) => {
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) =>
        player.id === playerId
          ? {
              ...player,
              position,
              currentPitchPosition: getDraggedPlayerPositionType(player, position),
            }
          : player,
      ),
    );
  }, [getDraggedPlayerPositionType, setPlayers]);

  const swapPitchPlayers = useCallback((sourcePlayerId: string, targetPlayerId: string) => {
    if (sourcePlayerId === targetPlayerId) return false;
    const snapshot = playersRef.current;
    const source = snapshot.find((player) => player.id === sourcePlayerId);
    const target = snapshot.find((player) => player.id === targetPlayerId);
    const dragStart =
      playerDragStartRef.current?.playerId === sourcePlayerId
        ? playerDragStartRef.current
        : null;
    const sourcePosition = dragStart?.position ?? source?.position;
    if (!source || !target?.position || !sourcePosition) return false;
    if (
      miniLeagueTeams &&
      source.teamSide &&
      target.teamSide &&
      source.teamSide !== target.teamSide
    ) {
      return false;
    }

    const sourcePitchPosition = dragStart?.currentPitchPosition ?? source.currentPitchPosition;
    const targetPosition = { ...target.position };
    const targetPitchPosition = target.currentPitchPosition;
    pushToUndoHistory(`Swap: ${source.name} ↔ ${target.name}`, snapshot);
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) => {
        if (player.id === sourcePlayerId) {
          return {
            ...player,
            position: targetPosition,
            currentPitchPosition: targetPitchPosition,
          };
        }
        if (player.id === targetPlayerId) {
          return {
            ...player,
            position: { ...sourcePosition },
            currentPitchPosition: sourcePitchPosition,
          };
        }
        return player;
      }),
    );
    flashSwapFeedback(sourcePlayerId, targetPlayerId);
    return true;
  }, [
    flashSwapFeedback,
    miniLeagueTeams,
    playerDragStartRef,
    playersRef,
    pushToUndoHistory,
    setPlayers,
  ]);

  return {
    capturePlayerDragOffset,
    getClientPitchPosition,
    getClientPointFromPitchPosition,
    getPitchPlayerOverlappingDragged,
    updateDraggedPlayerPosition,
    swapPitchPlayers,
  };
}
