import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { Player } from "../types";
import type { PitchPosition } from "../PositionBadge";

export interface ManualSubDeps {
  isUndoingRef: MutableRefObject<boolean>;
  playersRef: MutableRefObject<Player[]>;
  subMode: boolean;
  selectedOnPitch: string | null;
  selectedOnBench: string | null;
  players: Player[];
  benchToSubPlayer: string | null;
  setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
  setSelectedOnPitch: (id: string | null) => void;
  setSelectedOnBench: (id: string | null) => void;
  setSubMode: (v: boolean) => void;
  setPendingSubBenchPlayer: (id: string | null) => void;
  setRequiredPosition: (p: PitchPosition | null) => void;
  setPositionSwapDialogOpen: (v: boolean) => void;
  setBenchToSubOpen: (v: boolean) => void;
  runSubAnimation: (
    playerOutId: string,
    playerInId: string,
    swapPlayerId?: string
  ) => void;
  pushToUndoHistory: (description: string, snapshot: Player[]) => void;
  toast: (opts: { title: string; description?: string }) => void;
}

type PendingManualSub = {
  pitchPlayerId: string;
  benchPlayerId: string;
  swapPlayerId?: string;
} | null;

/**
 * Step 8b — Manual substitution confirm dialog flow:
 * - owns `manualSubConfirmOpen` + `pendingManualSub`
 * - the effect that auto-opens the dialog (or the position-swap dialog)
 *   once both a pitch and bench player are selected in subMode
 * - confirm/cancel handlers
 * - the bench-to-pitch picker handoff (`handleBenchToSubSelect`)
 *
 * Uses the depsRef pattern (mirrors `usePitchBoardDragDrop`) so the
 * caller can sync the latest external state each render without
 * destabilising the returned callbacks.
 */
export function usePitchBoardManualSub() {
  const [manualSubConfirmOpen, setManualSubConfirmOpen] = useState(false);
  const [pendingManualSub, setPendingManualSub] =
    useState<PendingManualSub>(null);

  const depsRef = useRef<ManualSubDeps | null>(null);

  const handleConfirmManualSub = useCallback(() => {
    const deps = depsRef.current;
    if (!deps || !pendingManualSub) return;

    const currentPlayers = deps.playersRef.current;
    const pitchPlayer = currentPlayers.find(
      (p) => p.id === pendingManualSub.pitchPlayerId
    );
    const benchPlayer = currentPlayers.find(
      (p) => p.id === pendingManualSub.benchPlayerId
    );
    const swapPlayer = pendingManualSub.swapPlayerId
      ? currentPlayers.find((p) => p.id === pendingManualSub.swapPlayerId)
      : null;

    console.log("[Undo] handleConfirmManualSub called:", {
      pitchPlayer: pitchPlayer?.name,
      benchPlayer: benchPlayer?.name,
      swapPlayer: swapPlayer?.name,
      pitchPlayerHasPosition: !!pitchPlayer?.position,
      currentPlayersCount: currentPlayers.length,
    });

    if (!pitchPlayer?.position || !benchPlayer) {
      console.log("[Undo] Early return - missing player or position");
      setManualSubConfirmOpen(false);
      setPendingManualSub(null);
      deps.setSelectedOnPitch(null);
      deps.setSelectedOnBench(null);
      return;
    }

    if (swapPlayer?.position) {
      deps.pushToUndoHistory(
        `Sub: ${benchPlayer.name} for ${pitchPlayer.name} (with swap)`,
        currentPlayers
      );

      const pitchPosition = { ...pitchPlayer.position };
      const pitchPositionType = pitchPlayer.currentPitchPosition;
      const swapPosition = { ...swapPlayer.position };
      const swapPositionType = swapPlayer.currentPitchPosition;

      deps.runSubAnimation(
        pendingManualSub.pitchPlayerId,
        pendingManualSub.benchPlayerId,
        pendingManualSub.swapPlayerId
      );

      deps.setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === pendingManualSub.pitchPlayerId) {
            return { ...p, position: null, currentPitchPosition: undefined };
          }
          if (p.id === pendingManualSub.swapPlayerId) {
            return {
              ...p,
              position: pitchPosition,
              currentPitchPosition: pitchPositionType,
            };
          }
          if (p.id === pendingManualSub.benchPlayerId) {
            return {
              ...p,
              position: swapPosition,
              currentPitchPosition: swapPositionType,
            };
          }
          return p;
        })
      );

      deps.toast({
        title: "Substitution made",
        description: `${benchPlayer.name} comes on, ${pitchPlayer.name} off`,
      });
    } else {
      deps.pushToUndoHistory(
        `Sub: ${benchPlayer.name} for ${pitchPlayer.name}`,
        currentPlayers
      );

      const pitchPosition = { ...pitchPlayer.position };
      const pitchPositionType = pitchPlayer.currentPitchPosition;

      deps.runSubAnimation(
        pendingManualSub.pitchPlayerId,
        pendingManualSub.benchPlayerId
      );

      deps.setPlayers((prev) =>
        prev.map((p) => {
          if (p.id === pendingManualSub.pitchPlayerId) {
            return { ...p, position: null, currentPitchPosition: undefined };
          }
          if (p.id === pendingManualSub.benchPlayerId) {
            return {
              ...p,
              position: pitchPosition,
              currentPitchPosition: pitchPositionType,
            };
          }
          return p;
        })
      );

      deps.toast({
        title: "Substitution made",
        description: `${benchPlayer.name} replaces ${pitchPlayer.name}`,
      });
    }

    setManualSubConfirmOpen(false);
    setPendingManualSub(null);
    deps.setSelectedOnPitch(null);
    deps.setSelectedOnBench(null);
    deps.setSubMode(false);
  }, [pendingManualSub]);

  const handleCancelManualSub = useCallback(() => {
    const deps = depsRef.current;
    setManualSubConfirmOpen(false);
    setPendingManualSub(null);
    deps?.setSelectedOnBench(null);
  }, []);

  const handleBenchToSubSelect = useCallback(
    (pitchPlayerId: string, swapPlayerId?: string) => {
      const deps = depsRef.current;
      if (!deps || !deps.benchToSubPlayer) return;
      const benchPlayerId = deps.benchToSubPlayer;
      deps.setBenchToSubOpen(false);
      setTimeout(() => {
        setPendingManualSub({ pitchPlayerId, benchPlayerId, swapPlayerId });
        setManualSubConfirmOpen(true);
      }, 150);
    },
    []
  );

  // Substitution dialog trigger — handles both direct subs and position swaps.
  // Reads live state via depsRef so we don't need exhaustive deps on the effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const deps = depsRef.current;
    if (!deps) return;
    if (deps.isUndoingRef.current) return;
    if (!deps.subMode || !deps.selectedOnPitch || !deps.selectedOnBench) return;

    const pitchPlayer = deps.players.find((p) => p.id === deps.selectedOnPitch);
    const benchPlayer = deps.players.find((p) => p.id === deps.selectedOnBench);

    if (!pitchPlayer?.position || !benchPlayer) return;

    const pitchPositionType = pitchPlayer.currentPitchPosition;
    const canPlayPosition =
      !benchPlayer.assignedPositions?.length ||
      !pitchPositionType ||
      benchPlayer.assignedPositions.includes(pitchPositionType);

    if (!canPlayPosition) {
      deps.setPendingSubBenchPlayer(deps.selectedOnBench);
      deps.setRequiredPosition(pitchPositionType || null);
      deps.setPositionSwapDialogOpen(true);
      deps.setSelectedOnPitch(null);
      deps.setSelectedOnBench(null);
    } else {
      console.log("[Undo] Direct sub - showing ManualSubConfirmDialog");
      setPendingManualSub({
        pitchPlayerId: deps.selectedOnPitch,
        benchPlayerId: deps.selectedOnBench,
      });
      setManualSubConfirmOpen(true);
      deps.setSelectedOnPitch(null);
      deps.setSelectedOnBench(null);
    }
    // Track selection identity only — the trigger fires when these change.
  }, [
    depsRef.current?.subMode,
    depsRef.current?.selectedOnPitch,
    depsRef.current?.selectedOnBench,
  ]);

  return {
    manualSubConfirmOpen,
    setManualSubConfirmOpen,
    pendingManualSub,
    setPendingManualSub,
    handleConfirmManualSub,
    handleCancelManualSub,
    handleBenchToSubSelect,
    /** Caller must update this ref every render with current externals. */
    manualSubDepsRef: depsRef,
  };
}
