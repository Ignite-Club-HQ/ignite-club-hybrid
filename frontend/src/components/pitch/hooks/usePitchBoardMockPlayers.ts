import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PitchPosition } from "../PositionBadge";
import type { Player, TeamSize } from "../types";

interface TeamMember {
  user_id: string;
  role: string;
  profiles: { display_name: string | null } | null;
}

interface TeamPlayerPosition {
  user_id: string | null;
  child_id: string | null;
  preferred_positions: string[] | null;
  jersey_number: number | null;
}

interface UsePitchBoardMockPlayersArgs {
  teamPlayerPositions: TeamPlayerPosition[] | undefined;
  teamSize: TeamSize;
  selectedFormation: number;
  members: TeamMember[];
  mockMode: boolean;
  setMockMode: Dispatch<SetStateAction<boolean>>;
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  hasLoadedRef: MutableRefObject<boolean>;
  setHasInitialized: Dispatch<SetStateAction<boolean>>;
  autoPlacePlayersOnPitch: (
    players: Player[],
    teamSize: TeamSize,
    formationIndex: number,
  ) => Player[];
}

const MOCK_NAMES = [
  "Alex Smith", "Jordan Lee", "Casey Brown", "Taylor Wilson", "Morgan Davis",
  "Riley Johnson", "Quinn Anderson", "Avery Thomas", "Cameron White", "Drew Martinez",
  "Jamie Garcia", "Peyton Robinson", "Skyler Clark", "Dakota Lewis", "Reese Walker",
];

export function usePitchBoardMockPlayers({
  teamPlayerPositions,
  teamSize,
  selectedFormation,
  members,
  mockMode,
  setMockMode,
  setPlayers,
  hasLoadedRef,
  setHasInitialized,
  autoPlacePlayersOnPitch,
}: UsePitchBoardMockPlayersArgs) {
  const generateMockPlayers = useCallback((count: number): Player[] => (
    Array.from({ length: count }, (_, index) => ({
      id: `mock-${index + 1}`,
      name: MOCK_NAMES[index] || `Player ${index + 1}`,
      number: index + 1,
      position: null,
      assignedPositions: [],
      minutesPlayed: 0,
    }))
  ), []);

  useEffect(() => {
    if (!teamPlayerPositions || mockMode) return;
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) => {
        const storedPosition = teamPlayerPositions.find(
          (position) =>
            position.user_id === player.id || position.child_id === player.id,
        );
        if (!storedPosition) return player;
        const assignedPositions =
          (storedPosition.preferred_positions || []) as PitchPosition[];
        const number = storedPosition.jersey_number ?? player.number;
        const positionsChanged =
          JSON.stringify(player.assignedPositions) !== JSON.stringify(assignedPositions);
        if (!positionsChanged && player.number === number) return player;
        return { ...player, assignedPositions, number };
      }),
    );
  }, [mockMode, setPlayers, teamPlayerPositions]);

  const handleUpdatePositions = useCallback((playerId: string, positions: PitchPosition[]) => {
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) =>
        player.id === playerId ? { ...player, assignedPositions: positions } : player,
      ),
    );
  }, [setPlayers]);

  const handleMockModeChange = useCallback((enabled: boolean) => {
    setMockMode(enabled);
    if (enabled) {
      const mockPlayers = generateMockPlayers(parseInt(teamSize, 10) + 2);
      setPlayers(autoPlacePlayersOnPitch(mockPlayers, teamSize, selectedFormation));
      hasLoadedRef.current = true;
      setHasInitialized(true);
      return;
    }

    setPlayers(
      members
        .filter((member) => member.role === "player")
        .map((member, index) => ({
          id: member.user_id,
          name: member.profiles?.display_name || `Player ${index + 1}`,
          number: index + 1,
          position: null,
          assignedPositions: [],
          currentPitchPosition: undefined,
          minutesPlayed: 0,
        })),
    );
  }, [
    autoPlacePlayersOnPitch,
    generateMockPlayers,
    hasLoadedRef,
    members,
    selectedFormation,
    setHasInitialized,
    setMockMode,
    setPlayers,
    teamSize,
  ]);

  const previousTeamSizeRef = useRef<TeamSize | null>(null);
  const previousFormationRef = useRef<number | null>(null);
  useEffect(() => {
    if (!mockMode) return;
    if (previousTeamSizeRef.current === null) {
      previousTeamSizeRef.current = teamSize;
      previousFormationRef.current = selectedFormation;
      return;
    }
    if (
      previousTeamSizeRef.current !== teamSize ||
      previousFormationRef.current !== selectedFormation
    ) {
      const mockPlayers = generateMockPlayers(parseInt(teamSize, 10) + 2);
      setPlayers(autoPlacePlayersOnPitch(mockPlayers, teamSize, selectedFormation));
      previousTeamSizeRef.current = teamSize;
      previousFormationRef.current = selectedFormation;
    }
  }, [
    autoPlacePlayersOnPitch,
    generateMockPlayers,
    mockMode,
    selectedFormation,
    setPlayers,
    teamSize,
  ]);

  return { handleUpdatePositions, handleMockModeChange };
}
