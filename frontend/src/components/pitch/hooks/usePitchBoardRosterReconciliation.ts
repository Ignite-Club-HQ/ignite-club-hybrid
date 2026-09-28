import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { clearPitchState } from "../pitchStateUtils";
import type { MiniLeagueTeams, PitchBoardState, Player, TeamSize } from "../types";

interface TeamMember {
  user_id: string;
  role: string;
  profiles: { display_name: string | null } | null;
}

interface TeamPlayerPosition {
  user_id: string | null;
  child_id: string | null;
  preferred_positions: Player["assignedPositions"] | null;
  jersey_number: number | null;
}

interface UsePitchBoardRosterReconciliationArgs {
  members: TeamMember[];
  teamPlayerPositions: TeamPlayerPosition[] | undefined;
  goingAttendeeIds: Set<string> | undefined;
  linkedEventId: string | null;
  initialLinkedEventId: string | null | undefined;
  savedState: PitchBoardState | null;
  miniLeagueTeams?: MiniLeagueTeams;
}

export function usePitchBoardRosterReconciliation({
  members,
  teamPlayerPositions,
  goingAttendeeIds,
  linkedEventId,
  initialLinkedEventId,
  savedState,
  miniLeagueTeams,
}: UsePitchBoardRosterReconciliationArgs) {
  const shouldFilterByGoing = !!linkedEventId && !miniLeagueTeams && !!goingAttendeeIds;
  const realPlayers = useMemo(() => {
    const seen = new Set<string>();
    return members
      .filter((member) => {
        if (member.role !== "player" || !member.user_id || seen.has(member.user_id)) {
          return false;
        }
        seen.add(member.user_id);
        return !shouldFilterByGoing || goingAttendeeIds!.has(member.user_id);
      })
      .map((member, index): Player => {
        const storedPosition = teamPlayerPositions?.find(
          (position) =>
            position.user_id === member.user_id ||
            position.child_id === member.user_id,
        );
        const teamSide = miniLeagueTeams?.teamAPlayerIds.includes(member.user_id)
          ? "a"
          : miniLeagueTeams?.teamBPlayerIds.includes(member.user_id)
            ? "b"
            : undefined;
        return {
          id: member.user_id,
          name: member.profiles?.display_name || `Player ${index + 1}`,
          number: storedPosition?.jersey_number || index + 1,
          position: null,
          assignedPositions: storedPosition?.preferred_positions || [],
          currentPitchPosition: undefined,
          minutesPlayed: 0,
          teamSide,
        };
      });
  }, [goingAttendeeIds, members, miniLeagueTeams, shouldFilterByGoing, teamPlayerPositions]);

  const savedStateIsForDifferentEvent =
    !!savedState?.linkedEventId &&
    !!initialLinkedEventId &&
    savedState.linkedEventId !== initialLinkedEventId;
  const savedPlayers = savedStateIsForDifferentEvent
    ? (savedState?.players || []).filter((player) => !player.isFillIn)
    : (savedState?.players || []);
  const savedAutoSubPlan = savedStateIsForDifferentEvent
    ? (savedState?.autoSubPlan || []).filter((step: any) =>
        savedPlayers.some((player) => player.id === step.playerId),
      )
    : (savedState?.autoSubPlan || []);
  const isStrictMatchEventRoster =
    !!(initialLinkedEventId || savedState?.linkedEventId) && !miniLeagueTeams;
  const strictMatchRosterPlayerIds = useMemo(
    () => new Set(realPlayers.map((player) => player.id)),
    [realPlayers],
  );
  const rsvpFilterReady = !linkedEventId || !!miniLeagueTeams || !!goingAttendeeIds;
  const savedRosterMissingCurrentPlayers =
    rsvpFilterReady &&
    savedPlayers.length > 0 &&
    realPlayers.some(
      (player) => !savedPlayers.some((savedPlayer) => savedPlayer.id === player.id),
    );
  const savedRosterHasPlayersOutsideCurrentRoster =
    isStrictMatchEventRoster &&
    savedPlayers.length > 0 &&
    realPlayers.length > 0 &&
    savedPlayers.some((player) => !strictMatchRosterPlayerIds.has(player.id));
  const savedRosterHasNoPlayersOnPitch =
    savedPlayers.length > 0 &&
    savedPlayers.every((player) => player.position === null);

  const applyStrictMatchRoster = useCallback((sourcePlayers: Player[]) => {
    const seen = new Set<string>();
    const deduplicated = sourcePlayers.filter((player) => {
      if (seen.has(player.id)) return false;
      seen.add(player.id);
      return true;
    });
    if (!isStrictMatchEventRoster || realPlayers.length === 0) return deduplicated;

    const filtered = deduplicated.filter(
      (player) => strictMatchRosterPlayerIds.has(player.id) || player.isFillIn,
    );
    const filteredIds = new Set(filtered.map((player) => player.id));
    return [
      ...filtered,
      ...realPlayers
        .filter((player) => !filteredIds.has(player.id))
        .map((player) => ({ ...player, position: null, currentPitchPosition: undefined })),
    ];
  }, [isStrictMatchEventRoster, realPlayers, strictMatchRosterPlayerIds]);

  const hasSamePlayerOrder = useCallback(
    (left: Player[], right: Player[]) =>
      left.length === right.length &&
      left.every((player, index) => player.id === right[index]?.id),
    [],
  );
  const shouldRebuildFromRealRoster =
    !!savedState &&
    !savedState.mockMode &&
    realPlayers.length > 0 &&
    (savedPlayers.length === 0 ||
      savedRosterMissingCurrentPlayers ||
      savedRosterHasNoPlayersOnPitch);

  return {
    realPlayers,
    savedStateIsForDifferentEvent,
    savedPlayers,
    savedAutoSubPlan,
    isStrictMatchEventRoster,
    savedRosterMissingCurrentPlayers,
    savedRosterHasPlayersOutsideCurrentRoster,
    savedRosterHasNoPlayersOnPitch,
    applyStrictMatchRoster,
    hasSamePlayerOrder,
    shouldRebuildFromRealRoster,
  };
}

interface UsePitchBoardLiveRosterSyncArgs {
  realPlayers: Player[];
  players: Player[];
  mockMode: boolean;
  savedState: PitchBoardState | null;
  teamId: string;
  teamSize: TeamSize;
  selectedFormation: number;
  miniLeagueTeams?: MiniLeagueTeams;
  shouldRebuildFromRealRoster: boolean;
  savedPlayers: Player[];
  savedRosterMissingCurrentPlayers: boolean;
  savedRosterHasNoPlayersOnPitch: boolean;
  isStrictMatchEventRoster: boolean;
  applyStrictMatchRoster: (players: Player[]) => Player[];
  hasSamePlayerOrder: (left: Player[], right: Player[]) => boolean;
  autoPlacePlayersOnPitch: (players: Player[], size: TeamSize, formation: number) => Player[];
  autoPlaceMiniLeaguePlayers: (players: Player[], size: TeamSize) => Player[];
  setPlayers: Dispatch<SetStateAction<Player[]>>;
}

export function usePitchBoardLiveRosterSync({
  realPlayers,
  players,
  mockMode,
  savedState,
  teamId,
  teamSize,
  selectedFormation,
  miniLeagueTeams,
  shouldRebuildFromRealRoster,
  savedPlayers,
  savedRosterMissingCurrentPlayers,
  savedRosterHasNoPlayersOnPitch,
  isStrictMatchEventRoster,
  applyStrictMatchRoster,
  hasSamePlayerOrder,
  autoPlacePlayersOnPitch,
  autoPlaceMiniLeaguePlayers,
  setPlayers,
}: UsePitchBoardLiveRosterSyncArgs) {
  const recoveredInvalidSavedRosterRef = useRef(shouldRebuildFromRealRoster);

  useEffect(() => {
    if (!isStrictMatchEventRoster || mockMode || realPlayers.length === 0) return;
    setPlayers((previousPlayers) => {
      const filtered = applyStrictMatchRoster(previousPlayers);
      return hasSamePlayerOrder(previousPlayers, filtered)
        ? previousPlayers
        : filtered;
    });
  }, [
    applyStrictMatchRoster,
    hasSamePlayerOrder,
    isStrictMatchEventRoster,
    mockMode,
    realPlayers.length,
    setPlayers,
  ]);

  useEffect(() => {
    if (mockMode || realPlayers.length === 0) return;
    if (shouldRebuildFromRealRoster && !recoveredInvalidSavedRosterRef.current) {
      recoveredInvalidSavedRosterRef.current = true;
      clearPitchState(teamId);
      console.log("[PitchState] Restoring live roster because saved state is stale", {
        savedCount: savedPlayers.length,
        realCount: realPlayers.length,
        missingCurrentPlayers: savedRosterMissingCurrentPlayers,
        noPlayersOnPitch: savedRosterHasNoPlayersOnPitch,
      });
      setPlayers(
        miniLeagueTeams
          ? autoPlaceMiniLeaguePlayers(realPlayers, teamSize)
          : autoPlacePlayersOnPitch(realPlayers, teamSize, selectedFormation),
      );
      return;
    }
    if (players.length > 0) return;
    if (savedState && !savedState.mockMode && savedState.players.length === 0) {
      console.log("[PitchState] Clearing stale empty saved state and restoring real players");
      clearPitchState(teamId);
    }
    console.log("[PitchState] realPlayers loaded async, syncing", realPlayers.length, "players");
    setPlayers(
      miniLeagueTeams
        ? autoPlaceMiniLeaguePlayers(realPlayers, teamSize)
        : autoPlacePlayersOnPitch(realPlayers, teamSize, selectedFormation),
    );
  }, [
    autoPlaceMiniLeaguePlayers,
    autoPlacePlayersOnPitch,
    miniLeagueTeams,
    mockMode,
    players.length,
    realPlayers,
    savedPlayers.length,
    savedRosterHasNoPlayersOnPitch,
    savedRosterMissingCurrentPlayers,
    savedState,
    selectedFormation,
    setPlayers,
    shouldRebuildFromRealRoster,
    teamId,
    teamSize,
  ]);
}
