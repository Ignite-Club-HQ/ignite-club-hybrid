import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Player } from "../types";

interface UsePitchBoardUndoArgs {
  isLandscape: boolean;
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  toast: (options: { title: string; description?: string }) => void;
}

const MAX_UNDO_HISTORY = 10;

export function usePitchBoardUndo({
  isLandscape,
  setPlayers,
  toast,
}: UsePitchBoardUndoArgs) {
  const [undoHistory, setUndoHistory] = useState<
    { players: Player[]; description: string }[]
  >([]);
  const [showFloatingUndo, setShowFloatingUndo] = useState(false);
  const floatingUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUndoingRef = useRef(false);

  const pushToUndoHistory = useCallback(
    (description: string, currentPlayers: Player[]) => {
      console.log("[Undo] pushToUndoHistory called:", {
        description,
        playerCount: currentPlayers.length,
        isLandscape,
      });
      setUndoHistory((previousHistory) => {
        const nextHistory = [
          ...previousHistory,
          { players: JSON.parse(JSON.stringify(currentPlayers)), description },
        ];
        console.log("[Undo] New history length:", nextHistory.length, "isLandscape:", isLandscape);
        return nextHistory.length > MAX_UNDO_HISTORY
          ? nextHistory.slice(-MAX_UNDO_HISTORY)
          : nextHistory;
      });

      console.log("[Undo] Setting showFloatingUndo to true");
      setShowFloatingUndo(true);
      if (floatingUndoTimerRef.current) {
        clearTimeout(floatingUndoTimerRef.current);
      }
      floatingUndoTimerRef.current = setTimeout(() => {
        console.log("[Undo] Timer expired, hiding floating undo");
        setShowFloatingUndo(false);
      }, isLandscape ? 30000 : 5000);
    },
    [isLandscape],
  );

  const handleUndo = useCallback(() => {
    if (isUndoingRef.current || undoHistory.length === 0) return;

    isUndoingRef.current = true;
    const lastState = undoHistory[undoHistory.length - 1];
    setPlayers(lastState.players);
    setUndoHistory((previousHistory) => {
      const nextHistory = previousHistory.slice(0, -1);
      if (nextHistory.length === 0) {
        setShowFloatingUndo(false);
        if (floatingUndoTimerRef.current) {
          clearTimeout(floatingUndoTimerRef.current);
          floatingUndoTimerRef.current = null;
        }
      }
      return nextHistory;
    });

    toast({
      title: "Undo successful",
      description: `Reverted: ${lastState.description}`,
    });

    requestAnimationFrame(() => {
      isUndoingRef.current = false;
    });
  }, [setPlayers, toast, undoHistory]);

  useEffect(() => {
    return () => {
      if (floatingUndoTimerRef.current) {
        clearTimeout(floatingUndoTimerRef.current);
      }
    };
  }, []);

  return {
    undoHistory,
    showFloatingUndo,
    isUndoingRef,
    pushToUndoHistory,
    handleUndo,
  };
}
