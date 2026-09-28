import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Player } from "../types";

interface UsePitchBoardSwapModeArgs {
  readOnly: boolean;
  swapMode: boolean;
  setSwapMode: Dispatch<SetStateAction<boolean>>;
  swapPlayer1: string | null;
  setSwapPlayer1: Dispatch<SetStateAction<string | null>>;
  swapPlayer2: string | null;
  setSwapPlayer2: Dispatch<SetStateAction<string | null>>;
  pitchSwapConfirmOpen: boolean;
  setPitchSwapConfirmOpen: Dispatch<SetStateAction<boolean>>;
  players: Player[];
  playersRef: MutableRefObject<Player[]>;
  miniLeagueTeams: unknown;
  subMode: boolean;
  setSubMode: (enabled: boolean) => void;
  selectedOnPitch: string | null;
  setSelectedOnPitch: Dispatch<SetStateAction<string | null>>;
  setSelectedOnBench: Dispatch<SetStateAction<string | null>>;
  getValidSwapPlayerIds: Set<string>;
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  pushToUndoHistory: (description: string, players: Player[]) => void;
  autoSubActive: boolean;
  regeneratePlanRef: MutableRefObject<(() => void) | null>;
  toast: (options: {
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  }) => void;
  setDrawingTool: (tool: "none") => void;
  setShowFloatingDrawToolbar: (visible: boolean) => void;
  setPortraitSheetOpen: (open: boolean) => void;
  setBenchCollapsed: (collapsed: boolean) => void;
  isLandscape: boolean;
  setSheetHeightPct: (height: number) => void;
  setToolbarCollapsed: (collapsed: boolean) => void;
  setBottomSheetTab: (tab: "bench") => void;
}

export function usePitchBoardSwapMode({
  readOnly,
  swapMode,
  setSwapMode,
  swapPlayer1,
  setSwapPlayer1,
  swapPlayer2,
  setSwapPlayer2,
  pitchSwapConfirmOpen,
  setPitchSwapConfirmOpen,
  players,
  playersRef,
  miniLeagueTeams,
  subMode,
  setSubMode,
  selectedOnPitch,
  setSelectedOnPitch,
  setSelectedOnBench,
  getValidSwapPlayerIds,
  setPlayers,
  pushToUndoHistory,
  autoSubActive,
  regeneratePlanRef,
  toast,
  setDrawingTool,
  setShowFloatingDrawToolbar,
  setPortraitSheetOpen,
  setBenchCollapsed,
  isLandscape,
  setSheetHeightPct,
  setToolbarCollapsed,
  setBottomSheetTab,
}: UsePitchBoardSwapModeArgs) {
  const handlePlayerClick = useCallback((playerId: string, isOnPitch: boolean) => {
    if (readOnly) return;

    if (swapMode && isOnPitch) {
      if (!swapPlayer1) {
        setSwapPlayer1(playerId);
      } else if (swapPlayer1 === playerId) {
        setSwapPlayer1(null);
      } else {
        if (!getValidSwapPlayerIds.has(playerId)) {
          const selectedPlayer = players.find((player) => player.id === swapPlayer1);
          const targetPlayer = players.find((player) => player.id === playerId);
          const isCrossTeam =
            miniLeagueTeams &&
            selectedPlayer?.teamSide &&
            targetPlayer?.teamSide &&
            selectedPlayer.teamSide !== targetPlayer.teamSide;
          toast({
            title: "Cannot swap",
            description: isCrossTeam
              ? "You can only swap players on the same team."
              : "Players are not eligible to play in each other's positions based on their position preferences.",
            variant: "destructive",
          });
          return;
        }
        setSwapPlayer2(playerId);
        setPitchSwapConfirmOpen(true);
      }
      return;
    }

    if (!subMode) return;

    if (isOnPitch) {
      console.log("[PlayerClick] Pitch player clicked:", playerId);
      setSelectedOnPitch(selectedOnPitch === playerId ? null : playerId);
    } else {
      console.log("[PlayerClick] Bench player clicked:", playerId);
      setSelectedOnBench((previous) => (previous === playerId ? null : playerId));
    }
  }, [
    getValidSwapPlayerIds,
    miniLeagueTeams,
    players,
    readOnly,
    selectedOnPitch,
    setSelectedOnBench,
    setSelectedOnPitch,
    subMode,
    swapMode,
    swapPlayer1,
    toast,
  ]);

  const toggleSwapMode = useCallback(() => {
    if (readOnly) return;
    const nextSwapMode = !swapMode;
    setSwapMode(nextSwapMode);
    setSwapPlayer1(null);
    setSwapPlayer2(null);

    if (nextSwapMode && subMode) {
      setSubMode(false);
      setSelectedOnPitch(null);
      setSelectedOnBench(null);
    }

    if (nextSwapMode) {
      setDrawingTool("none");
      setShowFloatingDrawToolbar(false);
      setPortraitSheetOpen(false);
    }
  }, [
    readOnly,
    setDrawingTool,
    setPortraitSheetOpen,
    setSelectedOnBench,
    setSelectedOnPitch,
    setShowFloatingDrawToolbar,
    setSubMode,
    subMode,
    swapMode,
  ]);

  const regenerateAfterSwap = useCallback(() => {
    if (!autoSubActive) return;
    setTimeout(() => {
      regeneratePlanRef.current?.();
      toast({
        title: "Auto-sub plan updated",
        description: "Plan regenerated to account for position swap",
      });
    }, 200);
  }, [autoSubActive, regeneratePlanRef, toast]);

  const handleConfirmPitchSwap = useCallback(() => {
    if (!swapPlayer1 || !swapPlayer2) return;

    const player1 = players.find((player) => player.id === swapPlayer1);
    const player2 = players.find((player) => player.id === swapPlayer2);
    if (!player1?.position || !player2?.position) {
      setPitchSwapConfirmOpen(false);
      setSwapPlayer1(null);
      setSwapPlayer2(null);
      return;
    }

    const player1Position = { ...player1.position };
    const player2Position = { ...player2.position };
    const player1PitchPosition = player1.currentPitchPosition;
    const player2PitchPosition = player2.currentPitchPosition;

    pushToUndoHistory(`Swap: ${player1.name} ↔ ${player2.name}`, playersRef.current);
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) => {
        if (player.id === swapPlayer1) {
          return {
            ...player,
            position: player2Position,
            currentPitchPosition: player2PitchPosition,
          };
        }
        if (player.id === swapPlayer2) {
          return {
            ...player,
            position: player1Position,
            currentPitchPosition: player1PitchPosition,
          };
        }
        return player;
      }),
    );
    toast({
      title: "Positions swapped",
      description: `${player1.name} ↔ ${player2.name}`,
    });
    setPitchSwapConfirmOpen(false);
    setSwapPlayer1(null);
    setSwapPlayer2(null);
    setSwapMode(false);
    regenerateAfterSwap();
  }, [
    players,
    playersRef,
    pushToUndoHistory,
    regenerateAfterSwap,
    setPlayers,
    swapPlayer1,
    swapPlayer2,
    toast,
  ]);

  const handleCancelPitchSwap = useCallback(() => {
    setPitchSwapConfirmOpen(false);
    setSwapPlayer1(null);
    setSwapPlayer2(null);
  }, []);

  const handleConfirmPitchSwapWithAccommodation = useCallback((
    accommodatorId: string,
    accommodatorNewPosition: string,
  ) => {
    if (!swapPlayer1 || !swapPlayer2) return;

    const player1 = players.find((player) => player.id === swapPlayer1);
    const player2 = players.find((player) => player.id === swapPlayer2);
    const accommodator = players.find((player) => player.id === accommodatorId);
    if (!player1?.position || !player2?.position || !accommodator?.position) {
      setPitchSwapConfirmOpen(false);
      setSwapPlayer1(null);
      setSwapPlayer2(null);
      return;
    }

    const player1Position = { ...player1.position };
    const player2Position = { ...player2.position };
    const accommodatorPosition = { ...accommodator.position };
    const player1PitchPosition = player1.currentPitchPosition;
    const player2PitchPosition = player2.currentPitchPosition;
    const accommodatorPitchPosition = accommodator.currentPitchPosition;

    pushToUndoHistory(
      `Swap: ${player1.name} ↔ ${player2.name} (${accommodator.name} accommodates)`,
      playersRef.current,
    );
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) => {
        if (player.id === swapPlayer1) {
          return accommodatorNewPosition === player2PitchPosition
            ? {
                ...player,
                position: accommodatorPosition,
                currentPitchPosition: accommodatorPitchPosition,
              }
            : {
                ...player,
                position: player2Position,
                currentPitchPosition: player2PitchPosition,
              };
        }
        if (player.id === swapPlayer2) {
          return accommodatorNewPosition === player1PitchPosition
            ? {
                ...player,
                position: accommodatorPosition,
                currentPitchPosition: accommodatorPitchPosition,
              }
            : {
                ...player,
                position: player1Position,
                currentPitchPosition: player1PitchPosition,
              };
        }
        if (player.id === accommodatorId) {
          return accommodatorNewPosition === player2PitchPosition
            ? {
                ...player,
                position: player2Position,
                currentPitchPosition: player2PitchPosition,
              }
            : {
                ...player,
                position: player1Position,
                currentPitchPosition: player1PitchPosition,
              };
        }
        return player;
      }),
    );
    toast({
      title: "Positions swapped with accommodation",
      description: `${player1.name} ↔ ${player2.name} (${accommodator.name} moved to ${accommodatorNewPosition})`,
    });
    setPitchSwapConfirmOpen(false);
    setSwapPlayer1(null);
    setSwapPlayer2(null);
    setSwapMode(false);
    regenerateAfterSwap();
  }, [
    players,
    playersRef,
    pushToUndoHistory,
    regenerateAfterSwap,
    setPlayers,
    swapPlayer1,
    swapPlayer2,
    toast,
  ]);

  const toggleSubMode = useCallback(() => {
    if (readOnly) return;
    const nextSubMode = !subMode;

    if (nextSubMode) {
      const availableBenchPlayers = players.filter(
        (player) => player.position === null && !player.isInjured,
      );
      if (availableBenchPlayers.length === 0) {
        toast({
          title: "No subs available",
          description: players.some((player) => player.position === null)
            ? "All bench players are currently injured."
            : "There are no players on the bench to bring on.",
        });
        return;
      }
    }

    setSubMode(nextSubMode);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);

    if (nextSubMode && swapMode) {
      setSwapMode(false);
      setSwapPlayer1(null);
      setSwapPlayer2(null);
    }

    if (nextSubMode) {
      setBenchCollapsed(false);
      if (isLandscape) {
        setSheetHeightPct(50);
        setToolbarCollapsed(false);
        setBottomSheetTab("bench");
      }
      setDrawingTool("none");
      setShowFloatingDrawToolbar(false);
      setPortraitSheetOpen(false);
    }
  }, [
    isLandscape,
    players,
    readOnly,
    setBenchCollapsed,
    setBottomSheetTab,
    setDrawingTool,
    setPortraitSheetOpen,
    setSelectedOnBench,
    setSelectedOnPitch,
    setSheetHeightPct,
    setShowFloatingDrawToolbar,
    setSubMode,
    setToolbarCollapsed,
    subMode,
    swapMode,
    toast,
  ]);

  return {
    swapMode,
    swapPlayer1,
    swapPlayer2,
    pitchSwapConfirmOpen,
    handlePlayerClick,
    toggleSwapMode,
    handleConfirmPitchSwap,
    handleCancelPitchSwap,
    handleConfirmPitchSwapWithAccommodation,
    toggleSubMode,
  };
}
