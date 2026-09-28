import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Player, PitchBoardState, TeamSize } from "../types";
import { clearPitchState } from "../pitchStateUtils";

interface UsePitchBoardPlayerBootstrapArgs {
  savedState: PitchBoardState | null;
  realPlayers: Player[];
  teamId: string;
  teamSize: TeamSize;
  selectedFormation: number;
  miniLeagueTeams: unknown;
  isStrictMatchEventRoster: boolean;
  savedRosterHasPlayersOutsideCurrentRoster: boolean;
  applyStrictMatchRoster: (players: Player[]) => Player[];
  autoPlacePlayersOnPitch: (players: Player[], size: TeamSize, formation: number) => Player[];
  autoPlaceMiniLeaguePlayers: (players: Player[], size: TeamSize) => Player[];
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  setHasInitialized: Dispatch<SetStateAction<boolean>>;
}

/**
 * Step 9d — One-shot player bootstrap for PitchBoard.
 *
 * Reconciles `savedState.players` with the freshly-fetched live roster
 * (`realPlayers`) the first time both are available. Handles four cases:
 *
 *   1. Saved state with `mockMode: true` → keep as-is.
 *   2. Saved state with empty player list but live roster present →
 *      treat as stale, clear localStorage, and auto-place the live roster.
 *   3. Saved state with real players → strict-roster repair (if applicable)
 *      and append any new players that aren't in the saved set.
 *   4. No saved state + live roster present → fresh auto-placement.
 *
 * If neither saved state nor `realPlayers` is ready yet, waits for the
 * next render.
 */
export function usePitchBoardPlayerBootstrap({
  savedState,
  realPlayers,
  teamId,
  teamSize,
  selectedFormation,
  miniLeagueTeams,
  isStrictMatchEventRoster,
  savedRosterHasPlayersOutsideCurrentRoster,
  applyStrictMatchRoster,
  autoPlacePlayersOnPitch,
  autoPlaceMiniLeaguePlayers,
  setPlayers,
  setHasInitialized,
}: UsePitchBoardPlayerBootstrapArgs) {
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;

    if (savedState) {
      if (savedState.mockMode) {
        hasLoadedRef.current = true;
        setHasInitialized(true);
        return;
      }

      if (savedState.players.length === 0 && realPlayers.length > 0) {
        console.log("[PitchState] Replacing stale empty saved state with live roster");
        clearPitchState(teamId);
        setPlayers(
          miniLeagueTeams
            ? autoPlaceMiniLeaguePlayers(realPlayers, teamSize)
            : autoPlacePlayersOnPitch(realPlayers, teamSize, selectedFormation)
        );
        hasLoadedRef.current = true;
        setHasInitialized(true);
        return;
      }

      const savedPlayerIds = new Set(savedState.players.map(p => p.id));
      const newPlayers = realPlayers.filter(p => !savedPlayerIds.has(p.id));
      if (isStrictMatchEventRoster && savedRosterHasPlayersOutsideCurrentRoster) {
        setPlayers(prev => applyStrictMatchRoster(prev));
      }

      if (newPlayers.length > 0) {
        setPlayers(prev => applyStrictMatchRoster([...prev, ...newPlayers]));
      }

      hasLoadedRef.current = true;
      setHasInitialized(true);
    } else if (realPlayers.length > 0) {
      if (miniLeagueTeams) {
        setPlayers(autoPlaceMiniLeaguePlayers(realPlayers, teamSize));
      } else {
        setPlayers(autoPlacePlayersOnPitch(realPlayers, teamSize, selectedFormation));
      }
      hasLoadedRef.current = true;
      setHasInitialized(true);
    }
    // If no saved state and no realPlayers yet, wait for realPlayers to load
  }, [
    savedState, realPlayers, autoPlacePlayersOnPitch, autoPlaceMiniLeaguePlayers,
    miniLeagueTeams, teamSize, selectedFormation, isStrictMatchEventRoster,
    savedRosterHasPlayersOutsideCurrentRoster, applyStrictMatchRoster,
    teamId, setPlayers, setHasInitialized,
  ]);

  return { hasLoadedRef };
}
