import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { PitchPosition } from "../PositionBadge";

// Structural Player — PitchBoard defines its own Player interface inline.
// We only need the fields the drag handlers actually read.
interface DragPlayer {
  id: string;
  position?: { x: number; y: number };
  currentPitchPosition?: PitchPosition;
}

/**
 * Player drag-and-drop for PitchBoard.
 *
 * Owns the two parallel input models that share state:
 * 1. HTML5 drag (desktop): handleDragStart / handleDragEnd / handlePitchDrop /
 *    handleBenchDrop / handleDragOver
 * 2. Touch (mobile): handleTouchStart on a player token, plus helpers
 *    (applyPitchTouchMove / finalizePitchTouchEnd) that PitchBoard's
 *    existing handlePitchTouchMove/End call from the drag branch — the pinch
 *    branch (see usePitchBoardPinchZoom) is checked first by PitchBoard.
 *
 * Bench-token touch fallback handlers (handleBenchTouchMove/End) are also
 * exposed for legacy bench drag wiring.
 *
 * iOS / Android WebView discipline preserved from the original PitchBoard:
 * - Touch handlers are synchronous; no awaits or async state transitions
 *   between finger-down and the gesture-sensitive call paths.
 * - We track the originating finger via `touchIdRef` so a second finger
 *   landing (pinch) never hijacks an in-flight drag.
 * - Refs (not state) carry per-gesture coordinates so we never tear the
 *   render mid-gesture.
 *
 * Dependency strategy: PitchBoard composes a large surface (players, pitch
 * coord helpers, swap helpers, sub-dialog setters). To keep the hook's
 * handler identities stable AND always read the freshest values, callers
 * pass a `depsRef` (MutableRefObject) and re-assign `depsRef.current` on
 * every render. Same pattern used in usePitchBoardFormationChangeDialog
 * and usePitchBoardLineup.
 */

export interface DragDropDeps {
  readOnly: boolean;
  players: DragPlayer[];
  playersOnPitch: DragPlayer[];
  playersRef: MutableRefObject<DragPlayer[]>;
  containerRef: MutableRefObject<HTMLDivElement | null>;

  capturePlayerDragOffset: (playerId: string, clientX: number, clientY: number) => void;
  getClientPitchPosition: (clientX: number, clientY: number) => { x: number; y: number } | null;
  getClientPointFromPitchPosition: (position: { x: number; y: number }) => { x: number; y: number } | null;
  getPitchPlayerOverlappingDragged: (draggedPlayerId: string, clientX: number, clientY: number) => string | null;
  updateDraggedPlayerPosition: (playerId: string, position: { x: number; y: number }) => void;
  swapPitchPlayers: (sourcePlayerId: string, targetPlayerId: string) => boolean;

  setBenchToSubPlayer: (id: string | null) => void;
  setBenchToSubOpen: (open: boolean) => void;
  setPortraitSheetOpen: (open: boolean) => void;
  setToolbarCollapsed: (collapsed: boolean) => void;
  setSelectedOnPitch: (id: string | null) => void;
  setSubPreviewOpen: (open: boolean) => void;
}

export function usePitchBoardDragDrop(depsRef: MutableRefObject<DragDropDeps>) {
  const [draggedPlayer, setDraggedPlayer] = useState<string | null>(null);
  const [touchDragPlayer, setTouchDragPlayer] = useState<string | null>(null);
  const [touchOffset, setTouchOffset] = useState<{ x: number; y: number } | null>(null);

  // Track the specific finger that initiated a touch drag so a second finger
  // (pinch) can't hijack the gesture mid-flight.
  const touchIdRef = useRef<number | null>(null);
  const playerDragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const playerDragStartRef = useRef<
    { playerId: string; position: { x: number; y: number }; currentPitchPosition?: PitchPosition } | null
  >(null);
  // Players we just dropped — used to suppress CSS transitions and tactical
  // offset drift for ~500ms so the token doesn't visibly snap back/forward.
  const recentlyDraggedRef = useRef<Set<string>>(new Set());

  const resetDragRefs = useCallback(() => {
    touchIdRef.current = null;
    playerDragOffsetRef.current = null;
    playerDragStartRef.current = null;
  }, []);

  // ===== HTML5 drag (desktop) =====

  const handleDragStart = useCallback((playerId: string, e?: React.DragEvent<HTMLDivElement>) => {
    const deps = depsRef.current;
    if (deps.readOnly) return;
    if (e) deps.capturePlayerDragOffset(playerId, e.clientX, e.clientY);
    const player = deps.playersRef.current.find(p => p.id === playerId);
    playerDragStartRef.current = player?.position
      ? { playerId, position: { ...player.position }, currentPitchPosition: player.currentPitchPosition }
      : null;
    setDraggedPlayer(playerId);
  }, [depsRef]);

  const handleDragEnd = useCallback(() => {
    setDraggedPlayer(null);
    playerDragOffsetRef.current = null;
    playerDragStartRef.current = null;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handlePitchDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const deps = depsRef.current;
    if (deps.readOnly) return;

    // Snapshot to avoid a stale-closure-style race if React re-renders mid-handler.
    const dragged = draggedPlayer;
    if (!dragged || !deps.containerRef.current) return;

    const draggedPlayerObj = deps.players.find(p => p.id === dragged);
    const draggedIsBench = draggedPlayerObj
      ? !deps.playersOnPitch.some(p => p.id === dragged)
      : false;

    // Bench → pitch: open BenchToSubDialog so the user picks who comes off.
    if (draggedIsBench) {
      deps.setBenchToSubPlayer(dragged);
      deps.setBenchToSubOpen(true);
      deps.setPortraitSheetOpen(false);
      deps.setToolbarCollapsed(true);
      setDraggedPlayer(null);
      playerDragOffsetRef.current = null;
      playerDragStartRef.current = null;
      return;
    }

    // Detect drop on another pitch player → swap positions.
    const draggedCenter = deps.getClientPitchPosition(e.clientX, e.clientY);
    const draggedCenterPoint = draggedCenter
      ? deps.getClientPointFromPitchPosition(draggedCenter)
      : null;
    const targetId = draggedCenterPoint
      ? deps.getPitchPlayerOverlappingDragged(dragged, draggedCenterPoint.x, draggedCenterPoint.y)
      : deps.getPitchPlayerOverlappingDragged(dragged, e.clientX, e.clientY);

    if (targetId && targetId !== dragged) {
      if (deps.swapPitchPlayers(dragged, targetId)) {
        setDraggedPlayer(null);
        playerDragOffsetRef.current = null;
        playerDragStartRef.current = null;
        return;
      }
    }

    const position = deps.getClientPitchPosition(e.clientX, e.clientY);
    if (position) deps.updateDraggedPlayerPosition(dragged, position);
    setDraggedPlayer(null);
    playerDragOffsetRef.current = null;
    playerDragStartRef.current = null;
  }, [depsRef, draggedPlayer]);

  const handleBenchDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const deps = depsRef.current;
    if (deps.readOnly) return;
    if (!draggedPlayer) return;
    const dragged = deps.players.find(p => p.id === draggedPlayer);
    const draggedIsOnPitch = dragged ? deps.playersOnPitch.some(p => p.id === draggedPlayer) : false;
    if (draggedIsOnPitch) {
      // Pitch → bench drag opens the sub picker for that pitch player.
      deps.setSelectedOnPitch(draggedPlayer);
      deps.setSubPreviewOpen(true);
    } else {
      // Bench player dropped back into bench area (which often overlaps the
      // pitch when the bottom sheet is open). Treat as bench → pitch.
      deps.setBenchToSubPlayer(draggedPlayer);
      deps.setBenchToSubOpen(true);
      deps.setPortraitSheetOpen(false);
      deps.setToolbarCollapsed(true);
    }
    setDraggedPlayer(null);
    playerDragOffsetRef.current = null;
    playerDragStartRef.current = null;
  }, [depsRef, draggedPlayer]);

  // ===== Touch drag (mobile) =====

  // Long-press / direct touch on a player token starts the drag. Synchronous —
  // never await or close popovers before this returns. (iOS gesture rule.)
  const handleTouchStart = useCallback((playerId: string, e: React.TouchEvent) => {
    const deps = depsRef.current;
    if (deps.readOnly) return;
    // Only allow one drag at a time – ignore if already tracking a finger.
    if (touchDragPlayer !== null) return;
    const touch = e.touches[0];
    touchIdRef.current = touch.identifier;
    deps.capturePlayerDragOffset(playerId, touch.clientX, touch.clientY);
    const player = deps.playersRef.current.find(p => p.id === playerId);
    playerDragStartRef.current = player?.position
      ? { playerId, position: { ...player.position }, currentPitchPosition: player.currentPitchPosition }
      : null;
    setTouchDragPlayer(playerId);
    setTouchOffset({ x: touch.clientX, y: touch.clientY });
  }, [depsRef, touchDragPlayer]);

  // Called from PitchBoard's handlePitchTouchMove drag branch.
  // Returns true if a player drag is in flight and was handled (caller should
  // skip any remaining touch-move logic).
  const applyPitchTouchMove = useCallback((e: React.TouchEvent): boolean => {
    const deps = depsRef.current;
    if (deps.readOnly) return false;
    if (!touchDragPlayer || !deps.containerRef.current || touchIdRef.current === null) return false;
    const touch = Array.from(e.touches).find(t => t.identifier === touchIdRef.current);
    if (!touch) return false;
    e.preventDefault();
    const position = deps.getClientPitchPosition(touch.clientX, touch.clientY);
    if (position) deps.updateDraggedPlayerPosition(touchDragPlayer, position);
    return true;
  }, [depsRef, touchDragPlayer]);

  // Called from PitchBoard's handlePitchTouchEnd drag branch (after pinch end).
  // Owns the full bench→pitch / swap / drop finalization.
  const finalizePitchTouchEnd = useCallback((e: React.TouchEvent) => {
    const deps = depsRef.current;
    if (deps.readOnly) return;
    if (!touchDragPlayer) return;

    // Only respond to the finger that started this drag.
    const touch = Array.from(e.changedTouches).find(t => t.identifier === touchIdRef.current);
    if (!touch) return;

    // Mark player as recently-dragged to suppress CSS transition AND tactical
    // offset drift for ~500ms.
    const draggedId = touchDragPlayer;
    recentlyDraggedRef.current.add(draggedId);
    setTimeout(() => recentlyDraggedRef.current.delete(draggedId), 500);

    // Bench → pitch via touch drag: open BenchToSubDialog so user picks who comes off.
    const draggedSrc = deps.players.find(p => p.id === touchDragPlayer);
    const draggedIsBench = draggedSrc
      ? !deps.playersOnPitch.some(p => p.id === touchDragPlayer)
      : false;
    if (draggedIsBench) {
      const pitchEl =
        document.getElementById("portrait-pitch-area") ||
        document.getElementById("landscape-pitch-area");
      if (pitchEl) {
        const rect = pitchEl.getBoundingClientRect();
        const isOnPitch =
          touch.clientX >= rect.left &&
          touch.clientX <= rect.right &&
          touch.clientY >= rect.top &&
          touch.clientY <= rect.bottom;
        if (isOnPitch) {
          deps.setBenchToSubPlayer(touchDragPlayer);
          deps.setBenchToSubOpen(true);
          deps.setPortraitSheetOpen(false);
          deps.setToolbarCollapsed(true);
          setTouchDragPlayer(null);
          setTouchOffset(null);
          resetDragRefs();
          return;
        }
      }
    }

    // Detect drop on another pitch token → swap positions.
    const draggedCenter = deps.getClientPitchPosition(touch.clientX, touch.clientY);
    const draggedCenterPoint = draggedCenter
      ? deps.getClientPointFromPitchPosition(draggedCenter)
      : null;
    const targetId = draggedCenterPoint
      ? deps.getPitchPlayerOverlappingDragged(touchDragPlayer, draggedCenterPoint.x, draggedCenterPoint.y)
      : deps.getPitchPlayerOverlappingDragged(touchDragPlayer, touch.clientX, touch.clientY);
    if (targetId && targetId !== touchDragPlayer) {
      if (deps.swapPitchPlayers(touchDragPlayer, targetId)) {
        setTouchDragPlayer(null);
        setTouchOffset(null);
        resetDragRefs();
        return;
      }
    }

    // Final position update from touchend to prevent coordinate gap with
    // the last touchmove sample.
    if (deps.containerRef.current) {
      const position = deps.getClientPitchPosition(touch.clientX, touch.clientY);
      if (position) deps.updateDraggedPlayerPosition(touchDragPlayer, position);
    }

    setTouchDragPlayer(null);
    setTouchOffset(null);
    resetDragRefs();
  }, [depsRef, touchDragPlayer, resetDragRefs]);

  // Bench-token touch fallback (used by legacy bench wiring that fires
  // touchmove/end directly on a bench player rather than the pitch surface).
  const handleBenchTouchMove = useCallback((e: React.TouchEvent) => {
    const deps = depsRef.current;
    if (deps.readOnly) return;
    if (!touchDragPlayer || !deps.containerRef.current || touchIdRef.current === null) return;
    const touch = Array.from(e.touches).find(t => t.identifier === touchIdRef.current);
    if (!touch) return;
    e.preventDefault();

    const pitchRect = deps.containerRef.current.getBoundingClientRect();
    if (
      touch.clientX >= pitchRect.left &&
      touch.clientX <= pitchRect.right &&
      touch.clientY >= pitchRect.top &&
      touch.clientY <= pitchRect.bottom
    ) {
      const position = deps.getClientPitchPosition(touch.clientX, touch.clientY);
      if (position) deps.updateDraggedPlayerPosition(touchDragPlayer, position);
    }
  }, [depsRef, touchDragPlayer]);

  const handleBenchTouchEnd = useCallback(() => {
    setTouchDragPlayer(null);
    setTouchOffset(null);
    resetDragRefs();
  }, [resetDragRefs]);

  // Imperative cancel used by the on-token onContextMenu / cancel guards
  // in PitchBoard's render: it has to be able to wipe touch-drag state from
  // outside a normal touch event handler.
  const cancelTouchDrag = useCallback(() => {
    setTouchDragPlayer(null);
    setTouchOffset(null);
    touchIdRef.current = null;
  }, []);

  return {
    // State
    draggedPlayer,
    touchDragPlayer,
    touchOffset,
    setDraggedPlayer,
    setTouchDragPlayer,
    setTouchOffset,

    // Refs (PitchBoard reads these in render and from other handlers like
    // formation persistence + swap-feedback).
    touchIdRef,
    playerDragOffsetRef,
    playerDragStartRef,
    recentlyDraggedRef,

    // HTML5 drag handlers
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handlePitchDrop,
    handleBenchDrop,

    // Touch drag handlers
    handleTouchStart,
    applyPitchTouchMove,
    finalizePitchTouchEnd,
    handleBenchTouchMove,
    handleBenchTouchEnd,
    cancelTouchDrag,
  };
}
