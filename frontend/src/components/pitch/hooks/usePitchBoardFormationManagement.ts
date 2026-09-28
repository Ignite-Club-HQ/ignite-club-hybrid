import { useCallback, type Dispatch, type SetStateAction } from "react";
import { getPositionFromCoords, getSpecificPositionLabel, FORMATIONS, type MiniLeagueTeams, type Player, type TeamSize } from "../types";
import type { PendingFormationChange } from "./usePitchBoardFormationChangeDialog";

interface UsePitchBoardFormationManagementArgs {
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  miniLeagueTeams?: MiniLeagueTeams;
  autoPlacePlayersOnPitch: (players: Player[], teamSize: TeamSize, formationIndex: number) => Player[];
  autoPlaceMiniLeaguePlayers: (players: Player[], teamSize: TeamSize, forceReposition?: boolean) => Player[];
  persistTeamSizeToDb: (teamSize: TeamSize) => void;
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  setTeamSize: Dispatch<SetStateAction<TeamSize>>;
  setSelectedFormation: Dispatch<SetStateAction<number>>;
  setBallPosition: Dispatch<SetStateAction<{ x: number; y: number }>>;
  setPendingFormationChange: (change: PendingFormationChange | null) => void;
  setFormationChangeDialogOpen: (open: boolean) => void;
  toast: (options: { title: string; description?: string }) => void;
}

export function usePitchBoardFormationManagement({
  players,
  teamSize,
  selectedFormation,
  miniLeagueTeams,
  autoPlacePlayersOnPitch,
  autoPlaceMiniLeaguePlayers,
  persistTeamSizeToDb,
  setPlayers,
  setTeamSize,
  setSelectedFormation,
  setBallPosition,
  setPendingFormationChange,
  setFormationChangeDialogOpen,
  toast,
}: UsePitchBoardFormationManagementArgs) {
  const handleResetFormation = useCallback(() => {
    const formation = FORMATIONS[teamSize][selectedFormation];
    if (!formation) return;

    const distance = (left: { x: number; y: number }, right: { x: number; y: number }) =>
      Math.hypot(left.x - right.x, left.y - right.y);
    const slots = formation.positions.map((position) => ({
      position,
      pitchPosition: getPositionFromCoords(position.y, teamSize),
      taken: false,
    }));
    const onPitch = players.filter((player) => player.position !== null);
    const onBench = players.filter((player) => player.position === null);
    const resetPlayers: Player[] = [];
    const unmatchedPlayers: Player[] = [];

    for (const player of onPitch) {
      const positionType =
        player.currentPitchPosition ??
        getPositionFromCoords(player.position!.y, teamSize);
      const candidates = slots.filter(
        (slot) => !slot.taken && slot.pitchPosition === positionType,
      );
      if (candidates.length === 0) {
        unmatchedPlayers.push(player);
        continue;
      }
      const slot = candidates.reduce((best, candidate) =>
        distance(player.position!, candidate.position) <
        distance(player.position!, best.position)
          ? candidate
          : best,
      );
      slot.taken = true;
      resetPlayers.push({
        ...player,
        position: slot.position,
        currentPitchPosition: slot.pitchPosition,
      });
    }

    for (const player of unmatchedPlayers) {
      const availableSlots = slots.filter((slot) => !slot.taken);
      if (availableSlots.length === 0) {
        resetPlayers.push(player);
        continue;
      }
      const slot = availableSlots.reduce((best, candidate) =>
        distance(player.position!, candidate.position) <
        distance(player.position!, best.position)
          ? candidate
          : best,
      );
      slot.taken = true;
      resetPlayers.push({ ...player, position: slot.position });
    }

    setPlayers([...resetPlayers, ...onBench]);
    setBallPosition({ x: 50, y: 50 });
    toast({
      title: "Formation Reset",
      description: "Players and ball have been moved back to formation positions.",
    });
  }, [
    players,
    selectedFormation,
    setBallPosition,
    setPlayers,
    teamSize,
    toast,
  ]);

  const handleTeamSizeChange = useCallback((newSize: TeamSize) => {
    if (newSize === teamSize) return;

    if (miniLeagueTeams) {
      setTeamSize(newSize);
      setSelectedFormation(0);
      const playersWithTeamSides: Player[] = players.map((player) => {
        if (player.teamSide) return player;
        const teamSide: Player["teamSide"] = miniLeagueTeams.teamAPlayerIds.includes(player.id)
          ? "a"
          : miniLeagueTeams.teamBPlayerIds.includes(player.id)
            ? "b"
            : undefined;
        return { ...player, teamSide };
      });
      setPlayers(autoPlaceMiniLeaguePlayers(playersWithTeamSides, newSize, true));
      persistTeamSizeToDb(newSize);
      return;
    }

    const newFormation = FORMATIONS[newSize][0];
    if (!newFormation) return;

    const playerCount = parseInt(newSize, 10);
    const playersOnPitch = players.filter((player) => player.position !== null);
    const benchPlayers = players.filter((player) => player.position === null);
    const allPlayers = [...playersOnPitch, ...benchPlayers];
    const nextPitchPlayers = allPlayers.slice(0, playerCount);
    const nextBenchPlayers = allPlayers.slice(playerCount);
    const positionSwaps: PendingFormationChange["positionSwaps"] = [];
    const benchMoves: PendingFormationChange["benchMoves"] = [];
    const minorAdjustments: NonNullable<PendingFormationChange["minorAdjustments"]> = [];

    for (const player of playersOnPitch) {
      if (nextBenchPlayers.some((nextBenchPlayer) => nextBenchPlayer.id === player.id)) {
        benchMoves.push({
          player,
          direction: "to-bench",
          position: player.currentPitchPosition,
        });
      }
    }

    for (let index = 0; index < nextPitchPlayers.length; index += 1) {
      const player = nextPitchPlayers[index];
      const formationPosition = newFormation.positions[index];
      if (benchPlayers.some((benchPlayer) => benchPlayer.id === player.id) && formationPosition) {
        benchMoves.push({
          player,
          direction: "to-pitch",
          position: getPositionFromCoords(formationPosition.y, newSize),
        });
      }
    }

    for (let index = 0; index < nextPitchPlayers.length; index += 1) {
      const player = nextPitchPlayers[index];
      const formationPosition = newFormation.positions[index];
      if (
        !player.currentPitchPosition ||
        !formationPosition ||
        !playersOnPitch.some((pitchPlayer) => pitchPlayer.id === player.id) ||
        nextBenchPlayers.some((benchPlayer) => benchPlayer.id === player.id)
      ) {
        continue;
      }
      const nextPosition = getPositionFromCoords(formationPosition.y, newSize);
      if (player.currentPitchPosition !== nextPosition) {
        positionSwaps.push({
          player,
          fromPosition: player.currentPitchPosition,
          toPosition: nextPosition,
          fromX: player.position?.x,
          toX: formationPosition.x,
        });
      } else {
        const fromLabel = getSpecificPositionLabel(
          player.position?.x,
          player.currentPitchPosition,
        );
        const toLabel = getSpecificPositionLabel(formationPosition.x, nextPosition);
        if (fromLabel !== toLabel) {
          minorAdjustments.push({ player, fromLabel, toLabel });
        }
      }
    }

    if (positionSwaps.length || benchMoves.length || minorAdjustments.length) {
      setPendingFormationChange({
        index: 0,
        newTeamSize: newSize,
        positionSwaps,
        benchMoves,
        minorAdjustments,
      });
      setFormationChangeDialogOpen(true);
      return;
    }

    setTeamSize(newSize);
    setSelectedFormation(0);
    setPlayers(autoPlacePlayersOnPitch(players, newSize, 0));
    persistTeamSizeToDb(newSize);
  }, [
    autoPlaceMiniLeaguePlayers,
    autoPlacePlayersOnPitch,
    miniLeagueTeams,
    persistTeamSizeToDb,
    players,
    setFormationChangeDialogOpen,
    setPendingFormationChange,
    setPlayers,
    setSelectedFormation,
    setTeamSize,
    teamSize,
  ]);

  return { handleResetFormation, handleTeamSizeChange };
}
