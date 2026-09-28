import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PitchPosition } from "../PositionBadge";
import type { Player } from "../types";

type PendingSwapBasedSub = {
  pitchPlayerId: string;
  benchPlayerId: string;
  swapPlayerId: string;
} | null;

interface UsePitchBoardSwapSubstitutionArgs {
  players: Player[];
  playersRef: MutableRefObject<Player[]>;
  playerDragStartRef: MutableRefObject<{
    playerId: string;
    position: { x: number; y: number };
    currentPitchPosition?: PitchPosition;
  } | null>;
  pendingSubBenchPlayer: string | null;
  requiredPosition: PitchPosition | null;
  selectedOnPitch: string | null;
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  setPendingSubBenchPlayer: Dispatch<SetStateAction<string | null>>;
  setRequiredPosition: Dispatch<SetStateAction<PitchPosition | null>>;
  setPositionSwapDialogOpen: Dispatch<SetStateAction<boolean>>;
  setSubPreviewOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedOnPitch: Dispatch<SetStateAction<string | null>>;
  setSelectedOnBench: Dispatch<SetStateAction<string | null>>;
  setSubMode: (enabled: boolean) => void;
  setPendingManualSub: (sub: {
    pitchPlayerId: string;
    benchPlayerId: string;
    swapPlayerId?: string;
  } | null) => void;
  setManualSubConfirmOpen: (open: boolean) => void;
  pushToUndoHistory: (description: string, players: Player[]) => void;
  runSubAnimation: (playerOutId: string, playerInId: string, swapPlayerId?: string) => void;
  toast: (options: { title: string; description?: string }) => void;
}

export function usePitchBoardSwapSubstitution({
  players,
  playersRef,
  playerDragStartRef,
  pendingSubBenchPlayer,
  requiredPosition,
  selectedOnPitch,
  setPlayers,
  setPendingSubBenchPlayer,
  setRequiredPosition,
  setPositionSwapDialogOpen,
  setSubPreviewOpen,
  setSelectedOnPitch,
  setSelectedOnBench,
  setSubMode,
  setPendingManualSub,
  setManualSubConfirmOpen,
  pushToUndoHistory,
  runSubAnimation,
  toast,
}: UsePitchBoardSwapSubstitutionArgs) {
  const [pendingSwapBasedSub, setPendingSwapBasedSub] =
    useState<PendingSwapBasedSub>(null);
  const [swapBeforeSubDialogOpen, setSwapBeforeSubDialogOpen] = useState(false);
  const [subAfterSwapDialogOpen, setSubAfterSwapDialogOpen] = useState(false);

  const handleSwapAndSubstitute = useCallback((
    playerToRemoveId: string,
    playerToSwapId: string,
  ) => {
    const playerToRemove = players.find((player) => player.id === playerToRemoveId);
    const playerToSwap = players.find((player) => player.id === playerToSwapId);
    const benchPlayer = players.find((player) => player.id === pendingSubBenchPlayer);
    if (
      !playerToRemove?.position ||
      !playerToSwap?.position ||
      !benchPlayer ||
      !requiredPosition ||
      !pendingSubBenchPlayer
    ) {
      return;
    }

    pushToUndoHistory(
      `Sub: ${benchPlayer.name} for ${playerToRemove.name} (with swap)`,
      playersRef.current,
    );
    const removedPlayerPosition = { ...playerToRemove.position };
    const swapPlayerPosition = { ...playerToSwap.position };
    runSubAnimation(playerToRemoveId, pendingSubBenchPlayer, playerToSwapId);
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) => {
        if (player.id === playerToRemoveId) {
          return { ...player, position: null, currentPitchPosition: undefined };
        }
        if (player.id === playerToSwapId) {
          return {
            ...player,
            position: removedPlayerPosition,
            currentPitchPosition: requiredPosition,
          };
        }
        if (player.id === pendingSubBenchPlayer) {
          return {
            ...player,
            position: swapPlayerPosition,
            currentPitchPosition: playerToSwap.currentPitchPosition,
          };
        }
        return player;
      }),
    );
    toast({
      title: "Substitution made",
      description: `${benchPlayer.name} comes on, ${playerToRemove.name} off`,
    });
    setPositionSwapDialogOpen(false);
    setPendingSubBenchPlayer(null);
    setRequiredPosition(null);
  }, [
    pendingSubBenchPlayer,
    players,
    playersRef,
    pushToUndoHistory,
    requiredPosition,
    runSubAnimation,
    setPendingSubBenchPlayer,
    setPlayers,
    setPositionSwapDialogOpen,
    setRequiredPosition,
    toast,
  ]);

  const handleSubPreviewSelect = useCallback((
    benchPlayerId: string,
    swapPlayerId?: string,
  ) => {
    const pitchPlayer = players.find((player) => player.id === selectedOnPitch);
    const benchPlayer = players.find((player) => player.id === benchPlayerId);
    if (!pitchPlayer?.position || !benchPlayer || !selectedOnPitch) return;

    const pitchPlayerId = selectedOnPitch;
    setSubPreviewOpen(false);
    setSelectedOnPitch(null);
    setTimeout(() => {
      setPendingManualSub({ pitchPlayerId, benchPlayerId, swapPlayerId });
      setManualSubConfirmOpen(true);
    }, 150);
  }, [
    players,
    selectedOnPitch,
    setManualSubConfirmOpen,
    setPendingManualSub,
    setSelectedOnPitch,
    setSubPreviewOpen,
  ]);

  const handlePreSwapFromDialog = useCallback((
    pitchPlayerId: string,
    swapPlayerId: string,
    options?: { reopenSubDialog?: boolean },
  ) => {
    const reopenSubDialog = options?.reopenSubDialog ?? true;
    const dragStart =
      playerDragStartRef.current?.playerId === pitchPlayerId
        ? playerDragStartRef.current
        : null;
    const pitchPlayer = players.find((player) => player.id === pitchPlayerId);
    const swapPlayer = players.find((player) => player.id === swapPlayerId);
    if (
      !pitchPlayer ||
      (!pitchPlayer.position && !dragStart?.position) ||
      !swapPlayer?.position
    ) {
      return;
    }

    const pitchPlayerPosition = dragStart?.position
      ? { ...dragStart.position }
      : { ...pitchPlayer.position! };
    const swapPlayerPosition = { ...swapPlayer.position };
    const pitchPlayerPitchPosition =
      dragStart?.currentPitchPosition ?? pitchPlayer.currentPitchPosition;
    const swapPlayerPitchPosition = swapPlayer.currentPitchPosition;
    pushToUndoHistory(
      `Swap: ${pitchPlayer.name} ↔ ${swapPlayer.name}`,
      playersRef.current,
    );
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) => {
        if (player.id === pitchPlayerId) {
          return {
            ...player,
            position: swapPlayerPosition,
            currentPitchPosition: swapPlayerPitchPosition,
          };
        }
        if (player.id === swapPlayerId) {
          return {
            ...player,
            position: pitchPlayerPosition,
            currentPitchPosition: pitchPlayerPitchPosition,
          };
        }
        return player;
      }),
    );
    toast({
      title: "Positions swapped",
      description: `${pitchPlayer.name} ↔ ${swapPlayer.name}`,
    });
    if (!reopenSubDialog) return;

    setSubPreviewOpen(false);
    setSelectedOnBench(null);
    setSelectedOnPitch(pitchPlayerId);
    setTimeout(() => {
      setSubPreviewOpen(true);
    }, 150);
  }, [
    playerDragStartRef,
    players,
    playersRef,
    pushToUndoHistory,
    setPlayers,
    setSelectedOnBench,
    setSelectedOnPitch,
    setSubPreviewOpen,
    toast,
  ]);

  const handleConfirmSwapBeforeSub = useCallback(() => {
    setSwapBeforeSubDialogOpen(false);
    setTimeout(() => {
      setSubAfterSwapDialogOpen(true);
    }, 150);
  }, []);

  const handleCancelSwapBasedSub = useCallback(() => {
    setSwapBeforeSubDialogOpen(false);
    setSubAfterSwapDialogOpen(false);
    setPendingSwapBasedSub(null);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);
  }, [setSelectedOnBench, setSelectedOnPitch]);

  const handleConfirmSubAfterSwap = useCallback(() => {
    if (!pendingSwapBasedSub) return;

    const pitchPlayer = players.find(
      (player) => player.id === pendingSwapBasedSub.pitchPlayerId,
    );
    const benchPlayer = players.find(
      (player) => player.id === pendingSwapBasedSub.benchPlayerId,
    );
    const swapPlayer = players.find(
      (player) => player.id === pendingSwapBasedSub.swapPlayerId,
    );
    if (!pitchPlayer?.position || !benchPlayer || !swapPlayer?.position) {
      handleCancelSwapBasedSub();
      return;
    }

    pushToUndoHistory(
      `Sub: ${benchPlayer.name} for ${pitchPlayer.name} (with swap)`,
      playersRef.current,
    );
    const pitchPlayerPosition = { ...pitchPlayer.position };
    const pitchPlayerPitchPosition = pitchPlayer.currentPitchPosition;
    const swapPlayerPosition = { ...swapPlayer.position };
    runSubAnimation(
      pendingSwapBasedSub.pitchPlayerId,
      pendingSwapBasedSub.benchPlayerId,
      pendingSwapBasedSub.swapPlayerId,
    );
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) => {
        if (player.id === pendingSwapBasedSub.pitchPlayerId) {
          return { ...player, position: null, currentPitchPosition: undefined };
        }
        if (player.id === pendingSwapBasedSub.swapPlayerId) {
          return {
            ...player,
            position: pitchPlayerPosition,
            currentPitchPosition: pitchPlayerPitchPosition,
          };
        }
        if (player.id === pendingSwapBasedSub.benchPlayerId) {
          return {
            ...player,
            position: swapPlayerPosition,
            currentPitchPosition: swapPlayer.currentPitchPosition,
          };
        }
        return player;
      }),
    );
    toast({
      title: "Substitution made",
      description: `${benchPlayer.name} comes on, ${pitchPlayer.name} off`,
    });
    setSubAfterSwapDialogOpen(false);
    setPendingSwapBasedSub(null);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);
    setSubMode(false);
  }, [
    handleCancelSwapBasedSub,
    pendingSwapBasedSub,
    players,
    playersRef,
    pushToUndoHistory,
    runSubAnimation,
    setPlayers,
    setSelectedOnBench,
    setSelectedOnPitch,
    setSubMode,
    toast,
  ]);

  return {
    pendingSwapBasedSub,
    swapBeforeSubDialogOpen,
    subAfterSwapDialogOpen,
    handleSwapAndSubstitute,
    handleSubPreviewSelect,
    handlePreSwapFromDialog,
    handleConfirmSwapBeforeSub,
    handleCancelSwapBasedSub,
    handleConfirmSubAfterSwap,
  };
}
