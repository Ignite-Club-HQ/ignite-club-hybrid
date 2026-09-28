import { useCallback } from "react";
import {
  FORMATIONS,
  getPositionFromCoords,
  type Player,
  type TeamSize,
} from "../types";
import type { PitchPosition } from "../PositionBadge";

export function usePitchBoardPlayerPlacement() {
  const autoPlacePlayersOnPitch = useCallback((
    playersToPlace: Player[],
    size: TeamSize,
    formationIndex: number,
  ): Player[] => {
    const formation = FORMATIONS[size][formationIndex];
    if (!formation) return playersToPlace;

    const canPlayPosition = (player: Player, pitchPosition: PitchPosition) =>
      !player.assignedPositions?.length ||
      player.assignedPositions.includes(pitchPosition);
    const slots = formation.positions.map((position) => ({
      position,
      pitchPosition: getPositionFromCoords(position.y, size),
      player: null as Player | null,
    }));
    const assignedPlayerIds = new Set<string>();

    for (const player of playersToPlace.filter(
      (candidate) => candidate.assignedPositions?.length === 1,
    )) {
      const targetPosition = player.assignedPositions![0];
      const slot = slots.find(
        (candidate) =>
          candidate.pitchPosition === targetPosition && !candidate.player,
      );
      if (slot && !assignedPlayerIds.has(player.id)) {
        slot.player = player;
        assignedPlayerIds.add(player.id);
      }
    }

    for (const player of playersToPlace.filter(
      (candidate) => (candidate.assignedPositions?.length || 0) > 1,
    )) {
      const slot = slots.find(
        (candidate) =>
          !candidate.player &&
          canPlayPosition(player, candidate.pitchPosition),
      );
      if (slot && !assignedPlayerIds.has(player.id)) {
        slot.player = player;
        assignedPlayerIds.add(player.id);
      }
    }

    for (const player of playersToPlace.filter(
      (candidate) => !candidate.assignedPositions?.length,
    )) {
      const slot = slots.find((candidate) => !candidate.player);
      if (slot && !assignedPlayerIds.has(player.id)) {
        slot.player = player;
        assignedPlayerIds.add(player.id);
      }
    }

    return [
      ...slots.flatMap(({ player, position, pitchPosition }) =>
        player
          ? [{ ...player, position, currentPitchPosition: pitchPosition }]
          : [],
      ),
      ...playersToPlace
        .filter((player) => !assignedPlayerIds.has(player.id))
        .map((player) => ({
          ...player,
          position: null,
          currentPitchPosition: undefined,
        })),
    ];
  }, []);

  const autoPlaceMiniLeaguePlayers = useCallback((
    playersToPlace: Player[],
    size: TeamSize,
    preserveOnPitchStatus = false,
    formationIndex = 0,
    applyFormationPositions = false,
  ): Player[] => {
    const formation = FORMATIONS[size][formationIndex] || FORMATIONS[size][0];
    if (!formation) return playersToPlace;

    const teamAPlayers = playersToPlace.filter((player) => player.teamSide === "a");
    const teamBPlayers = playersToPlace.filter((player) => player.teamSide === "b");
    const unassignedPlayers = playersToPlace.filter((player) => !player.teamSide);
    const result: Player[] = [];
    const scaleToBottomHalf = (position: { x: number; y: number }) => ({
      x: position.x,
      y: 50 + (position.y / 100) * 45,
    });
    const scaleToTopHalf = (position: { x: number; y: number }) => ({
      x: 100 - position.x,
      y: 50 - (position.y / 100) * 45,
    });
    const placePlayer = (
      player: Player,
      index: number,
      scalePosition: (position: { x: number; y: number }) => { x: number; y: number },
    ): Player => {
      if (index >= formation.positions.length) {
        return { ...player, position: null, currentPitchPosition: undefined };
      }
      const formationPosition = formation.positions[index];
      return {
        ...player,
        position: scalePosition(formationPosition),
        currentPitchPosition: getPositionFromCoords(formationPosition.y, size),
      };
    };

    if (preserveOnPitchStatus && applyFormationPositions) {
      const teamAOnPitch = teamAPlayers.filter((player) => player.position !== null);
      const teamBOnPitch = teamBPlayers.filter((player) => player.position !== null);

      teamAOnPitch.forEach((player, index) => {
        if (index < formation.positions.length) {
          result.push(placePlayer(player, index, scaleToBottomHalf));
        } else {
          result.push({
            ...player,
            currentPitchPosition: getPositionFromCoords(player.position!.y, size),
          });
        }
      });
      result.push(
        ...teamAPlayers
          .filter((player) => player.position === null)
          .map((player) => ({ ...player })),
      );

      teamBOnPitch.forEach((player, index) => {
        if (index < formation.positions.length) {
          result.push(placePlayer(player, index, scaleToTopHalf));
        } else {
          result.push({
            ...player,
            currentPitchPosition: getPositionFromCoords(100 - player.position!.y, size),
          });
        }
      });
      result.push(
        ...teamBPlayers
          .filter((player) => player.position === null)
          .map((player) => ({ ...player })),
      );
    } else if (preserveOnPitchStatus) {
      const targetSize = parseInt(size);
      const placeTeam = (
        teamPlayers: Player[],
        scalePosition: (position: { x: number; y: number }) => { x: number; y: number },
      ) => {
        const onPitch = teamPlayers.filter((player) => player.position !== null);
        const onBench = teamPlayers.filter((player) => player.position === null);
        const ordered = [...onPitch, ...onBench];
        result.push(
          ...ordered
            .slice(0, targetSize)
            .map((player, index) => placePlayer(player, index, scalePosition)),
          ...ordered.slice(targetSize).map((player) => ({
            ...player,
            position: null,
            currentPitchPosition: undefined,
          })),
        );
      };
      placeTeam(teamAPlayers, scaleToBottomHalf);
      placeTeam(teamBPlayers, scaleToTopHalf);
    } else {
      result.push(
        ...teamAPlayers.map((player, index) =>
          placePlayer(player, index, scaleToBottomHalf),
        ),
        ...teamBPlayers.map((player, index) =>
          placePlayer(player, index, scaleToTopHalf),
        ),
      );
    }

    result.push(
      ...unassignedPlayers.map((player) => ({
        ...player,
        position: null,
        currentPitchPosition: undefined,
      })),
    );
    return result;
  }, []);

  return { autoPlacePlayersOnPitch, autoPlaceMiniLeaguePlayers };
}
