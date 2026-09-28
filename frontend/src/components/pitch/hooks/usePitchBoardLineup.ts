import { useCallback, MutableRefObject } from "react";
import { FORMATIONS, getPositionFromCoords, getSpecificPositionLabel, MiniLeagueTeams, Player, TeamSize } from "../types";
import { PitchPosition } from "../PositionBadge";
import type { PendingFormationChange } from "./usePitchBoardFormationChangeDialog";

type SetPlayers = (updater: Player[] | ((prev: Player[]) => Player[])) => void;
type PositionSwap = PendingFormationChange["positionSwaps"][number];
type BenchMove = PendingFormationChange["benchMoves"][number];

export interface LineupDeps {
  // state values
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  miniLeagueTeams: MiniLeagueTeams | null;
  autoSubActive: boolean;
  selectedTeamForSettings: "a" | "b" | "both";
  // setters
  setPlayers: SetPlayers;
  setSelectedFormation: (i: number) => void;
  setPreferredSecondHalfGkId: (id: string | undefined) => void;
  setAutoSubPlanEditMode: (v: boolean) => void;
  setAutoSubFromPreGame: (v: boolean) => void;
  setAutoSubPlanDialogOpen: (v: boolean) => void;
  setShowLineupPicker: (v: boolean) => void;
  setPendingFormationChange: (p: PendingFormationChange | null) => void;
  setFormationChangeDialogOpen: (v: boolean) => void;
  // helpers
  autoPlacePlayersOnPitch: (players: Player[], teamSize: TeamSize, formationIndex: number) => Player[];
  autoPlaceMiniLeaguePlayers: (
    players: Player[],
    teamSize: TeamSize,
    repositionAll?: boolean,
    formationIndex?: number,
    bothTeams?: boolean
  ) => Player[];
  persistFormationToDb: (name: string) => void;
  notifyFormationOrSizeChange: (
    kind: 'formation' | 'team_size',
    value: string,
    details?: { positionSwaps: PositionSwap[]; benchMoves: BenchMove[] }
  ) => void;
  regeneratePlanRef: MutableRefObject<(() => void) | null>;
  toast: (opts: { title: string; description?: string }) => void;
}

/**
 * Owns lineup confirm/skip and formation-change preview/apply logic.
 * Uses a depsRef so it can be declared early in the component before
 * downstream callbacks (notifyFormationOrSizeChange, etc.) are defined.
 */
export function usePitchBoardLineup(depsRef: MutableRefObject<LineupDeps | null>) {
  const handleLineupConfirm = useCallback(
    (updatedPlayers: Player[], firstHalfGkId?: string, secondHalfGkId?: string) => {
      const deps = depsRef.current;
      if (!deps) return;
      const seen = new Set<string>();
      const freshPlayers = updatedPlayers
        .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
        .map(p => ({ ...p, minutesPlayed: 0 }));
      deps.setPlayers(freshPlayers);
      deps.setPreferredSecondHalfGkId(secondHalfGkId);
      if (firstHalfGkId || secondHalfGkId) {
        console.log("[PitchBoard] Lineup confirmed with GK rotation:", { firstHalfGkId, secondHalfGkId });
      }
      deps.setAutoSubPlanEditMode(false);
      deps.setAutoSubFromPreGame(true);
      deps.setAutoSubPlanDialogOpen(true);
      setTimeout(() => {
        deps.setShowLineupPicker(false);
      }, 100);
    },
    [depsRef]
  );

  const handleLineupSkip = useCallback(() => {
    const deps = depsRef.current;
    if (!deps) return;
    if (!deps.miniLeagueTeams) {
      deps.setPlayers(deps.autoPlacePlayersOnPitch(deps.players, deps.teamSize, deps.selectedFormation));
    }
    deps.setShowLineupPicker(false);
    setTimeout(() => {
      deps.setAutoSubPlanEditMode(false);
      deps.setAutoSubFromPreGame(true);
      deps.setAutoSubPlanDialogOpen(true);
    }, 300);
  }, [depsRef]);

  const applyFormationChange = useCallback(
    (
      index: number,
      changeDetails?: { positionSwaps: PositionSwap[]; benchMoves: BenchMove[] }
    ) => {
      const deps = depsRef.current;
      if (!deps) return;
      const { teamSize, miniLeagueTeams, selectedTeamForSettings } = deps;
      const formation = FORMATIONS[teamSize][index];
      if (!formation) return;

      deps.setSelectedFormation(index);
      deps.persistFormationToDb(formation.name);

      // Mini-league branch
      if (miniLeagueTeams) {
        const targetTeam = selectedTeamForSettings;
        deps.setPlayers(prev => {
          const playersWithTeamSide = prev.map(p => {
            if (p.teamSide) return p;
            let teamSide: "a" | "b" | undefined;
            if (miniLeagueTeams.teamAPlayerIds.includes(p.id)) teamSide = "a";
            else if (miniLeagueTeams.teamBPlayerIds.includes(p.id)) teamSide = "b";
            return { ...p, teamSide };
          });

          if (targetTeam === "both") {
            return deps.autoPlaceMiniLeaguePlayers(playersWithTeamSide, teamSize, true, index, true);
          }

          const scaleToBottomHalf = (pos: { x: number; y: number }) => ({ x: pos.x, y: 50 + (pos.y / 100) * 45 });
          const scaleToTopHalf = (pos: { x: number; y: number }) => ({ x: 100 - pos.x, y: 50 - (pos.y / 100) * 45 });
          const scaleFunc = targetTeam === "a" ? scaleToBottomHalf : scaleToTopHalf;

          const teamOnPitch = playersWithTeamSide.filter(pp => pp.teamSide === targetTeam && pp.position !== null);

          return playersWithTeamSide.map(p => {
            if (p.teamSide !== targetTeam) return p;
            if (p.position === null) return p;
            const playerIndex = teamOnPitch.findIndex(pp => pp.id === p.id);
            if (playerIndex >= 0 && playerIndex < formation.positions.length) {
              const pos = scaleFunc(formation.positions[playerIndex]);
              return {
                ...p,
                position: pos,
                currentPitchPosition: getPositionFromCoords(formation.positions[playerIndex].y, teamSize),
              };
            }
            return { ...p, position: null, currentPitchPosition: undefined };
          });
        });

        const teamLabel = targetTeam === "both"
          ? "both teams"
          : targetTeam === "a"
            ? (miniLeagueTeams.teamAName || "Team A")
            : (miniLeagueTeams.teamBName || "Team B");
        deps.toast({ title: "Formation applied", description: `${formation.name} set for ${teamLabel}` });
        return;
      }

      const numPositions = parseInt(teamSize);

      deps.setPlayers(prev => {
        const playersOnPitch = prev.filter(p => p.position !== null);
        const benchPlayers = prev.filter(p => p.position === null);
        const allPlayers = [...playersOnPitch, ...benchPlayers];

        const updated = prev.map(p => ({
          ...p,
          position: null as { x: number; y: number } | null,
          currentPitchPosition: undefined as PitchPosition | undefined,
        }));

        const willBeOnPitch = allPlayers.slice(0, numPositions);
        const stayingOnPitch = willBeOnPitch.filter(p => playersOnPitch.some(pp => pp.id === p.id));
        const comingFromBench = willBeOnPitch.filter(p => benchPlayers.some(bp => bp.id === p.id));

        const slots = formation.positions.map((pos, i) => ({
          index: i,
          position: getPositionFromCoords(pos.y, teamSize),
          x: pos.x,
          y: pos.y,
          taken: false,
        }));

        const playerSlotMap = new Map<string, number>();
        const availSlots = () => slots.filter(s => !s.taken);

        for (const player of stayingOnPitch) {
          if (playerSlotMap.has(player.id)) continue;
          const fromLabel = getSpecificPositionLabel(player.position?.x, player.currentPitchPosition!);
          const slot = availSlots().find(s => getSpecificPositionLabel(s.x, s.position) === fromLabel);
          if (slot) { slot.taken = true; playerSlotMap.set(player.id, slot.index); }
        }
        for (const player of stayingOnPitch) {
          if (playerSlotMap.has(player.id)) continue;
          const slot = availSlots().find(s => s.position === player.currentPitchPosition);
          if (slot) { slot.taken = true; playerSlotMap.set(player.id, slot.index); }
        }
        for (const player of stayingOnPitch) {
          if (playerSlotMap.has(player.id)) continue;
          const remaining = availSlots();
          if (remaining.length > 0) {
            const px = player.position?.x ?? 50;
            const py = player.position?.y ?? 50;
            remaining.sort((a, b) => (Math.abs(a.x - px) + Math.abs(a.y - py)) - (Math.abs(b.x - px) + Math.abs(b.y - py)));
            remaining[0].taken = true;
            playerSlotMap.set(player.id, remaining[0].index);
          }
        }

        for (const player of stayingOnPitch) {
          const slotIdx = playerSlotMap.get(player.id);
          if (slotIdx == null) continue;
          const playerIndex = updated.findIndex(p => p.id === player.id);
          if (playerIndex !== -1) {
            const pos = { ...formation.positions[slotIdx] };
            updated[playerIndex].position = pos;
            updated[playerIndex].currentPitchPosition = getPositionFromCoords(pos.y, teamSize);
          }
        }

        const remainingSlots = slots.filter(s => !s.taken);
        for (let i = 0; i < comingFromBench.length && i < remainingSlots.length; i++) {
          const playerIndex = updated.findIndex(p => p.id === comingFromBench[i].id);
          if (playerIndex !== -1) {
            const pos = { ...formation.positions[remainingSlots[i].index] };
            updated[playerIndex].position = pos;
            updated[playerIndex].currentPitchPosition = getPositionFromCoords(pos.y, teamSize);
          }
        }

        return updated;
      });

      deps.toast({ title: "Formation applied", description: `${formation.name} formation set` });
      deps.notifyFormationOrSizeChange('formation', formation.name, changeDetails);

      if (deps.autoSubActive) {
        setTimeout(() => {
          deps.regeneratePlanRef.current?.();
        }, 300);
      }
    },
    [depsRef]
  );

  const handleFormationChange = useCallback(
    (value: string) => {
      const deps = depsRef.current;
      if (!deps) return;
      const { selectedFormation, teamSize, miniLeagueTeams, players } = deps;
      const index = parseInt(value);
      if (index === selectedFormation) return;
      const formation = FORMATIONS[teamSize][index];
      if (!formation) return;

      if (miniLeagueTeams) {
        applyFormationChange(index);
        return;
      }

      const numPositions = parseInt(teamSize);
      const playersOnPitch = players.filter(p => p.position !== null);
      const benchPlayers = players.filter(p => p.position === null);
      const allPlayers = [...playersOnPitch, ...benchPlayers];

      const positionSwaps: PositionSwap[] = [];
      const benchMoves: BenchMove[] = [];

      const willBeOnPitch = allPlayers.slice(0, numPositions);
      const willBeOnBench = allPlayers.slice(numPositions);

      for (const player of playersOnPitch) {
        if (willBeOnBench.some(p => p.id === player.id)) {
          benchMoves.push({ player, direction: "to-bench", position: player.currentPitchPosition });
        }
      }
      for (let i = 0; i < willBeOnPitch.length; i++) {
        const player = willBeOnPitch[i];
        if (benchPlayers.some(p => p.id === player.id) && formation.positions[i]) {
          const newPos = getPositionFromCoords(formation.positions[i].y, teamSize);
          benchMoves.push({ player, direction: "to-pitch", position: newPos });
        }
      }

      const minorAdjustments: { player: Player; fromLabel: string; toLabel: string }[] = [];
      const stayingOnPitch = willBeOnPitch.filter(
        p => p.currentPitchPosition && playersOnPitch.some(pp => pp.id === p.id) && !willBeOnBench.some(bp => bp.id === p.id)
      );

      const formationSlots = formation.positions.map((pos, i) => ({
        index: i,
        position: getPositionFromCoords(pos.y, teamSize),
        x: pos.x,
        y: pos.y,
        taken: false,
      }));

      for (let i = 0; i < willBeOnPitch.length; i++) {
        const player = willBeOnPitch[i];
        if (benchPlayers.some(p => p.id === player.id)) {
          formationSlots[i].taken = true;
        }
      }

      const playerSlotMap = new Map<string, number>();
      const availableSlots = () => formationSlots.filter(s => !s.taken);

      for (const player of stayingOnPitch) {
        if (playerSlotMap.has(player.id)) continue;
        const fromLabel = getSpecificPositionLabel(player.position?.x, player.currentPitchPosition!);
        const slot = availableSlots().find(s => getSpecificPositionLabel(s.x, s.position) === fromLabel);
        if (slot) { slot.taken = true; playerSlotMap.set(player.id, slot.index); }
      }
      for (const player of stayingOnPitch) {
        if (playerSlotMap.has(player.id)) continue;
        const slot = availableSlots().find(s => s.position === player.currentPitchPosition);
        if (slot) { slot.taken = true; playerSlotMap.set(player.id, slot.index); }
      }
      for (const player of stayingOnPitch) {
        if (playerSlotMap.has(player.id)) continue;
        const remaining = availableSlots();
        if (remaining.length > 0) {
          const px = player.position?.x ?? 50;
          const py = player.position?.y ?? 50;
          remaining.sort((a, b) => (Math.abs(a.x - px) + Math.abs(a.y - py)) - (Math.abs(b.x - px) + Math.abs(b.y - py)));
          remaining[0].taken = true;
          playerSlotMap.set(player.id, remaining[0].index);
        }
      }

      for (const player of stayingOnPitch) {
        const slotIdx = playerSlotMap.get(player.id);
        if (slotIdx == null) continue;
        const slot = formationSlots[slotIdx];
        const newPosition = slot.position;
        if (player.currentPitchPosition !== newPosition) {
          positionSwaps.push({
            player,
            fromPosition: player.currentPitchPosition!,
            toPosition: newPosition,
            fromX: player.position?.x,
            toX: slot.x,
          });
        } else {
          const fromLabel = getSpecificPositionLabel(player.position?.x, player.currentPitchPosition!);
          const toLabel = getSpecificPositionLabel(slot.x, newPosition);
          if (fromLabel !== toLabel) {
            minorAdjustments.push({ player, fromLabel, toLabel });
          }
        }
      }

      if (positionSwaps.length > 0 || benchMoves.length > 0 || minorAdjustments.length > 0) {
        deps.setPendingFormationChange({ index, positionSwaps, benchMoves, minorAdjustments });
        deps.setFormationChangeDialogOpen(true);
        return;
      }

      applyFormationChange(index);
    },
    [depsRef, applyFormationChange]
  );

  return {
    handleLineupConfirm,
    handleLineupSkip,
    handleFormationChange,
    applyFormationChange,
  };
}
