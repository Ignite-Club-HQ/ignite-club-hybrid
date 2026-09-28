import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { X, Check, RotateCcw, Zap, GripVertical, RefreshCw, Scale, ChevronDown, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { Player, TeamSize, FORMATIONS, getPositionFromCoords } from "./types";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";

const TEAM_SIZES: TeamSize[] = ["3", "4", "5", "6", "7", "8", "9", "10", "11"];

interface PreGameLineupScreenProps {
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  rotateGkAtHalftime: boolean;
  onConfirm: (players: Player[], firstHalfGkId?: string, secondHalfGkId?: string) => void;
  onSkip: () => void;
  onClose: () => void;
  onTeamSizeChange?: (size: TeamSize) => void;
  onFormationChange?: (index: number) => void;
  /** Auto-sub rotation speed: 2 = Balanced (default), 3 = Frequent.
   *  Legacy value 1 ("Minimal") is migrated to 2 by the planner; the picker
   *  shows only the two supported modes. */
  rotationSpeed?: number;
  onRotationSpeedChange?: (speed: number) => void;
}

interface FormationSlot {
  index: number;
  position: { x: number; y: number };
  pitchPosition: PitchPosition;
  assignedPlayerId: string | null;
}

// Position color map for pitch circles
const CIRCLE_COLORS: Record<PitchPosition, { empty: string; emptyBorder: string; filled: string; filledBorder: string }> = {
  GK: { empty: "bg-yellow-500/25", emptyBorder: "border-yellow-400/60", filled: "bg-yellow-600/90", filledBorder: "border-yellow-300/70" },
  DEF: { empty: "bg-blue-500/25", emptyBorder: "border-blue-400/60", filled: "bg-blue-600/90", filledBorder: "border-blue-300/70" },
  MID: { empty: "bg-emerald-500/25", emptyBorder: "border-emerald-400/60", filled: "bg-emerald-600/90", filledBorder: "border-emerald-300/70" },
  FWD: { empty: "bg-red-500/25", emptyBorder: "border-red-400/60", filled: "bg-red-600/90", filledBorder: "border-red-300/70" },
};

function buildSlots(formation: { positions: { x: number; y: number }[] } | undefined, teamSize: TeamSize): FormationSlot[] {
  if (!formation) return [];
  return formation.positions.map((pos, index) => ({
    index,
    position: pos,
    pitchPosition: getPositionFromCoords(pos.y, teamSize),
    assignedPlayerId: null,
  }));
}

// ── Drag & Drop types ──
interface DragState {
  playerId: string;
  ghostX: number;
  ghostY: number;
  startX: number;
  startY: number;
  hasMoved: boolean;
  directionLocked: 'drag' | 'scroll' | null; // null = undecided
}

const DRAG_THRESHOLD = 12; // px movement cancels pending long-press
const LONG_PRESS_MS = 300; // ms hold before drag activates

export default function PreGameLineupScreen({
  players,
  teamSize,
  selectedFormation,
  rotateGkAtHalftime,
  onConfirm,
  onSkip,
  onClose,
  onTeamSizeChange,
  onFormationChange,
  rotationSpeed,
  onRotationSpeedChange,
}: PreGameLineupScreenProps) {
  const formation = FORMATIONS[teamSize][selectedFormation];
  const hasGk = !["3", "4", "5", "6"].includes(teamSize);

  const initialSlots = useMemo(() => {
    const base = buildSlots(formation, teamSize);
    // Prefill from existing player positions so re-opening Setup doesn't wipe the lineup.
    const onPitch = players.filter(p => p.position && !p.isInjured);
    const used = new Set<string>();
    for (const slot of base) {
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const p of onPitch) {
        if (used.has(p.id)) continue;
        const dx = (p.position!.x - slot.position.x);
        const dy = (p.position!.y - slot.position.y);
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestId = p.id; }
      }
      // Only assign if reasonably close (within ~25% of pitch); otherwise leave empty
      if (bestId && bestDist < 25 * 25) {
        slot.assignedPlayerId = bestId;
        used.add(bestId);
      }
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formation, teamSize]);

  const [slots, setSlots] = useState<FormationSlot[]>(initialSlots);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const [firstHalfGkId, setFirstHalfGkId] = useState<string | null>(() => {
    const gkSlot = initialSlots.find(s => s.pitchPosition === "GK");
    return gkSlot?.assignedPlayerId ?? null;
  });
  const [secondHalfGkId, setSecondHalfGkId] = useState<string | null>(null);

  // ── Drag state ──
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);
  const slotRefs = useRef<Map<number, HTMLElement>>(new Map());
  const pitchContainerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  // Keep ref in sync for use in event handlers
  useEffect(() => { dragRef.current = dragState; }, [dragState]);

  // GK rotation toggle state - starts with the prop value
  const [rotateGk, setRotateGk] = useState(rotateGkAtHalftime);

  // Collapsible setup sections — collapsed by default to maximise pitch room.
  // Each opens independently so coaches can tweak without losing the others.
  const [openSection, setOpenSection] = useState<null | "size" | "formation" | "subs">(null);
  const toggleSection = useCallback((s: "size" | "formation" | "subs") => {
    setOpenSection(prev => (prev === s ? null : s));
  }, []);
  const _rs = rotationSpeed ?? 1;
  const subsSpeedLabel = _rs >= 2 ? "Frequent" : "Standard";


  const handleTeamSizeChange = useCallback((newSize: TeamSize) => {
    const newFormation = FORMATIONS[newSize][0];
    const newSlots = buildSlots(newFormation, newSize);
    const oldAssignments = slots.filter(s => s.assignedPlayerId).map(s => s.assignedPlayerId!);
    let idx = 0;
    for (const slot of newSlots) {
      if (idx < oldAssignments.length) {
        slot.assignedPlayerId = oldAssignments[idx];
        idx++;
      }
    }
    setSlots(newSlots);
    setSelectedSlotIndex(null);
    setFirstHalfGkId(null);
    setSecondHalfGkId(null);
    onTeamSizeChange?.(newSize);
    onFormationChange?.(0);
  }, [slots, onTeamSizeChange, onFormationChange]);

  const handleFormationChange = useCallback((formationIndex: number) => {
    const newFormation = FORMATIONS[teamSize][formationIndex];
    const newSlots = buildSlots(newFormation, teamSize);
    const oldAssignments = slots.filter(s => s.assignedPlayerId).map(s => s.assignedPlayerId!);
    let idx = 0;
    for (const slot of newSlots) {
      if (idx < oldAssignments.length) {
        slot.assignedPlayerId = oldAssignments[idx];
        idx++;
      }
    }
    setSlots(newSlots);
    setSelectedSlotIndex(null);
    onFormationChange?.(formationIndex);
  }, [teamSize, slots, onFormationChange]);

  const assignedPlayerIds = useMemo(
    () => new Set(slots.filter(s => s.assignedPlayerId).map(s => s.assignedPlayerId!)),
    [slots]
  );

  const benchPlayers = useMemo(
    () => {
      // Defensive dedupe by id — upstream sources occasionally fan out
      // duplicate roster rows (e.g. multi-role members) which would otherwise
      // render the same player multiple times in the bench list.
      const seen = new Set<string>();
      return players.filter(p => {
        if (assignedPlayerIds.has(p.id) || p.isInjured) return false;
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
    },
    [players, assignedPlayerIds]
  );


  const gkCapablePlayers = useMemo(
    () => players.filter(p => !p.isInjured && (!p.assignedPositions?.length || p.assignedPositions.includes("GK"))),
    [players]
  );

  // Auto-pick 2nd half GK: least-minutes GK-capable player excluding 1st half GK
  const autoSecondHalfGk = useMemo(() => {
    if (!rotateGk || !firstHalfGkId) return null;
    const candidates = gkCapablePlayers
      .filter(p => p.id !== firstHalfGkId && !p.isInjured)
      .sort((a, b) => (a.minutesPlayed || 0) - (b.minutesPlayed || 0));
    return candidates[0] || null;
  }, [rotateGk, firstHalfGkId, gkCapablePlayers]);

  // If no explicit 2nd half GK chosen, use auto-pick
  const effective2ndHalfGkId = secondHalfGkId || autoSecondHalfGk?.id || null;

  const canPlayPosition = useCallback((player: Player, pitchPos: PitchPosition): boolean => {
    if (!player.assignedPositions?.length) return true;
    return player.assignedPositions.includes(pitchPos);
  }, []);

  const filteredBenchPlayers = useMemo(() => {
    if (selectedSlotIndex === null) return benchPlayers;
    const slot = slots[selectedSlotIndex];
    if (!slot) return benchPlayers;
    return [...benchPlayers].sort((a, b) => {
      const aEligible = canPlayPosition(a, slot.pitchPosition);
      const bEligible = canPlayPosition(b, slot.pitchPosition);
      if (aEligible && !bEligible) return -1;
      if (!aEligible && bEligible) return 1;
      return 0;
    });
  }, [selectedSlotIndex, slots, benchPlayers, canPlayPosition]);

  const handleSlotTap = useCallback((slotIndex: number) => {
    if (dragState) return; // Don't handle taps during drag
    const slot = slots[slotIndex];
    if (slot.assignedPlayerId) {
      setSlots(prev => prev.map((s, i) => i === slotIndex ? { ...s, assignedPlayerId: null } : s));
      if (slot.assignedPlayerId === firstHalfGkId) setFirstHalfGkId(null);
      if (slot.assignedPlayerId === secondHalfGkId) setSecondHalfGkId(null);
      setSelectedSlotIndex(null);
    } else {
      setSelectedSlotIndex(slotIndex);
    }
  }, [slots, firstHalfGkId, secondHalfGkId, dragState]);

  const handlePickPlayer = useCallback((playerId: string) => {
    if (dragState) return;
    let targetIndex = selectedSlotIndex;
    if (targetIndex === null) {
      const player = players.find(p => p.id === playerId);
      const matchingSlot = player?.assignedPositions?.length
        ? slots.findIndex(s => !s.assignedPlayerId && player.assignedPositions!.includes(s.pitchPosition))
        : -1;
      if (matchingSlot !== undefined && matchingSlot >= 0) {
        targetIndex = matchingSlot;
      } else {
        targetIndex = slots.findIndex(s => !s.assignedPlayerId);
      }
      if (targetIndex < 0) return;
    }
    const finalIndex = targetIndex;
    setSlots(prev => prev.map((s, i) =>
      i === finalIndex ? { ...s, assignedPlayerId: playerId } : s
    ));
    const slot = slots[finalIndex];
    if (slot.pitchPosition === "GK" && !firstHalfGkId) {
      setFirstHalfGkId(playerId);
    }
    setSelectedSlotIndex(null);
  }, [selectedSlotIndex, slots, firstHalfGkId, players, dragState]);

  // ── Drag & Drop handlers ──
  const assignPlayerToSlot = useCallback((playerId: string, slotIndex: number) => {
    const slot = slots[slotIndex];
    
    setSlots(prev => prev.map((s, i) => {
      if (s.assignedPlayerId === playerId && i !== slotIndex) return { ...s, assignedPlayerId: null };
      if (i === slotIndex) return { ...s, assignedPlayerId: playerId };
      return s;
    }));
    
    if (slot.pitchPosition === "GK") {
      setFirstHalfGkId(playerId);
    }
    setSelectedSlotIndex(null);
  }, [slots]);

  const findSlotUnderPoint = useCallback((x: number, y: number): number | null => {
    // Expand hit area for easier drop targeting
    const HIT_EXPAND = 12;
    for (const [index, el] of slotRefs.current.entries()) {
      const rect = el.getBoundingClientRect();
      if (
        x >= rect.left - HIT_EXPAND &&
        x <= rect.right + HIT_EXPAND &&
        y >= rect.top - HIT_EXPAND &&
        y <= rect.bottom + HIT_EXPAND
      ) {
        return index;
      }
    }
    return null;
  }, []);

  // Long-press timer refs
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDragRef = useRef<{ playerId: string; startX: number; startY: number } | null>(null);
  const pendingDragCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suppressNextClick = useCallback(() => {
    suppressClickRef.current = true;
    if (suppressClickTimerRef.current) {
      clearTimeout(suppressClickTimerRef.current);
    }
    suppressClickTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false;
      suppressClickTimerRef.current = null;
    }, 350);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (pendingDragCleanupRef.current) {
      pendingDragCleanupRef.current();
      pendingDragCleanupRef.current = null;
    }
    pendingDragRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cancelLongPress();
      if (suppressClickTimerRef.current) {
        clearTimeout(suppressClickTimerRef.current);
      }
    };
  }, [cancelLongPress]);

  const handleDragStart = useCallback((playerId: string, clientX: number, clientY: number) => {
    cancelLongPress();
    pendingDragRef.current = { playerId, startX: clientX, startY: clientY };

    const onPendingMove = (e: TouchEvent | PointerEvent) => {
      const point = "touches" in e ? e.touches[0] : e;
      if (!point || !pendingDragRef.current) return;

      const dx = Math.abs(point.clientX - pendingDragRef.current.startX);
      const dy = Math.abs(point.clientY - pendingDragRef.current.startY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        suppressNextClick();
        cancelLongPress();
      }
    };

    const onPendingEnd = () => cancelLongPress();
    const onPendingScroll = () => {
      suppressNextClick();
      cancelLongPress();
    };

    window.addEventListener("touchmove", onPendingMove, { passive: true });
    window.addEventListener("pointermove", onPendingMove, { passive: true });
    window.addEventListener("pointerup", onPendingEnd);
    window.addEventListener("pointercancel", onPendingEnd);
    window.addEventListener("touchend", onPendingEnd);
    window.addEventListener("touchcancel", onPendingEnd);
    window.addEventListener("scroll", onPendingScroll, { passive: true, capture: true });

    pendingDragCleanupRef.current = () => {
      window.removeEventListener("touchmove", onPendingMove);
      window.removeEventListener("pointermove", onPendingMove);
      window.removeEventListener("pointerup", onPendingEnd);
      window.removeEventListener("pointercancel", onPendingEnd);
      window.removeEventListener("touchend", onPendingEnd);
      window.removeEventListener("touchcancel", onPendingEnd);
      window.removeEventListener("scroll", onPendingScroll, true);
    };

    longPressTimerRef.current = setTimeout(() => {
      const pending = pendingDragRef.current;
      if (!pending) return;

      if (pendingDragCleanupRef.current) {
        pendingDragCleanupRef.current();
        pendingDragCleanupRef.current = null;
      }
      pendingDragRef.current = null;
      longPressTimerRef.current = null;

      const newState: DragState = {
        playerId: pending.playerId,
        ghostX: pending.startX,
        ghostY: pending.startY,
        startX: pending.startX,
        startY: pending.startY,
        hasMoved: false,
        directionLocked: "drag",
      };
      setDragState(newState);
      setSelectedSlotIndex(null);
      suppressClickRef.current = true;
    }, LONG_PRESS_MS);
  }, [cancelLongPress, suppressNextClick]);

  const handleDragMove = useCallback((clientX: number, clientY: number) => {
    // If drag not yet activated, check if user moved too much (scrolling)
    if (pendingDragRef.current && !dragRef.current) {
      const dx = Math.abs(clientX - pendingDragRef.current.startX);
      const dy = Math.abs(clientY - pendingDragRef.current.startY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        suppressNextClick();
        cancelLongPress();
      }
      return;
    }

    const current = dragRef.current;
    if (!current) return;

    const dx = clientX - current.startX;
    const dy = clientY - current.startY;
    const hasMoved = current.hasMoved || Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD;

    setDragState(prev => prev ? { ...prev, ghostX: clientX, ghostY: clientY, hasMoved } : null);

    if (hasMoved) {
      const slotIdx = findSlotUnderPoint(clientX, clientY);
      setHoveredSlotIndex(slotIdx);
    }
  }, [findSlotUnderPoint, cancelLongPress, suppressNextClick]);

  const handleDragEnd = useCallback(() => {
    cancelLongPress();
    const current = dragRef.current;
    if (current?.hasMoved) {
      suppressNextClick();
      if (hoveredSlotIndex !== null) {
        assignPlayerToSlot(current.playerId, hoveredSlotIndex);
      }
    }
    setDragState(null);
    setHoveredSlotIndex(null);
  }, [hoveredSlotIndex, assignPlayerToSlot, cancelLongPress, suppressNextClick]);

  // Global pointer/touch move & end listeners during active drag
  useEffect(() => {
    if (!dragState) return;

    const onPointerMove = (e: PointerEvent) => {
      e.preventDefault();
      handleDragMove(e.clientX, e.clientY);
    };
    const onPointerUp = () => handleDragEnd();
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      handleDragMove(t.clientX, t.clientY);
    };
    const onTouchEnd = () => handleDragEnd();

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [dragState, handleDragMove, handleDragEnd]);

  const handleAutoFill = useCallback(() => {
    const newSlots = [...slots];
    const used = new Set(newSlots.filter(s => s.assignedPlayerId).map(s => s.assignedPlayerId!));
    const available = players.filter(p => !used.has(p.id) && !p.isInjured);
    for (const slot of newSlots) {
      if (slot.assignedPlayerId) continue;
      const specialist = available.find(
        p => !used.has(p.id) && p.assignedPositions?.length === 1 && p.assignedPositions[0] === slot.pitchPosition
      );
      if (specialist) { slot.assignedPlayerId = specialist.id; used.add(specialist.id); continue; }
      const eligible = available.find(p => !used.has(p.id) && canPlayPosition(p, slot.pitchPosition));
      if (eligible) { slot.assignedPlayerId = eligible.id; used.add(eligible.id); continue; }
      const anyone = available.find(p => !used.has(p.id));
      if (anyone) { slot.assignedPlayerId = anyone.id; used.add(anyone.id); }
    }
    setSlots(newSlots);
    if (hasGk && !firstHalfGkId) {
      const gkSlot = newSlots.find(s => s.pitchPosition === "GK" && s.assignedPlayerId);
      if (gkSlot) setFirstHalfGkId(gkSlot.assignedPlayerId);
    }
  }, [slots, players, canPlayPosition, hasGk, firstHalfGkId]);

  const handleClearAll = useCallback(() => {
    setSlots(prev => prev.map(s => ({ ...s, assignedPlayerId: null })));
    setFirstHalfGkId(null);
    setSecondHalfGkId(null);
    setSelectedSlotIndex(null);
  }, []);

  const handleConfirm = useCallback(() => {
    const updatedPlayers = players.map(player => {
      const slot = slots.find(s => s.assignedPlayerId === player.id);
      if (slot) {
        return { ...player, position: slot.position, currentPitchPosition: slot.pitchPosition };
      }
      return { ...player, position: null as { x: number; y: number } | null, currentPitchPosition: undefined };
    });
    const finalSecondHalfGkId = rotateGk ? (effective2ndHalfGkId || undefined) : undefined;
    onConfirm(updatedPlayers, firstHalfGkId || undefined, finalSecondHalfGkId);
  }, [players, slots, firstHalfGkId, effective2ndHalfGkId, rotateGk, onConfirm]);

  const filledSlots = slots.filter(s => s.assignedPlayerId).length;
  const totalSlots = slots.length;
  const getPlayerById = useCallback((id: string) => players.find(p => p.id === id), [players]);

  const formations = FORMATIONS[teamSize];

  const isDragging = dragState?.hasMoved ?? false;
  const draggedPlayer = dragState ? getPlayerById(dragState.playerId) : null;

  return (
    <div className="fixed inset-0 z-[99999] bg-background flex flex-col" style={{ touchAction: isDragging ? 'none' : undefined }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="p-1 -ml-1 rounded-full hover:bg-muted" aria-label="Close">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
          <h2 className="text-lg font-bold">Starting Lineup</h2>
          <Badge variant="outline" className="text-xs">
            {filledSlots}/{totalSlots}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">1</span>
            <span className="font-medium text-foreground">Lineup</span>
            <span className="text-muted-foreground/50 mx-0.5">→</span>
            <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">2</span>
            <span>Subs</span>
          </div>
        </div>
      </div>

      {/* Main content - fully scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ touchAction: isDragging ? 'none' : undefined }}>
        {/* Setup sections — collapsed by default so the pitch dominates the
            viewport. Tap a row to expand; only one is open at a time. */}
        <div className="border-b border-border bg-muted/20 divide-y divide-border/60">
          {/* Players per Team */}
          <div>
            <button
              type="button"
              onClick={() => toggleSection("size")}
              aria-expanded={openSection === "size"}
              aria-controls="setup-section-size"
              className="w-full flex items-center justify-between px-4 py-2 min-h-[40px] text-left hover:bg-muted/40 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Players per Team</span>
                <span className="text-sm font-semibold text-foreground tabular-nums">{teamSize}</span>
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  openSection === "size" && "rotate-180"
                )}
              />
            </button>
            {openSection === "size" && (
              <div id="setup-section-size" className="px-4 pb-2">
                <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-label="Players per team">
                  {TEAM_SIZES.map(size => (
                    <button
                      key={size}
                      className={cn(
                        "flex-1 min-h-[44px] text-sm font-medium transition-colors",
                        size === teamSize
                          ? "bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted text-foreground"
                      )}
                      aria-label={`${size} players per team`}
                      aria-pressed={size === teamSize}
                      onClick={() => handleTeamSizeChange(size)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Formation */}
          <div>
            <button
              type="button"
              onClick={() => toggleSection("formation")}
              aria-expanded={openSection === "formation"}
              aria-controls="setup-section-formation"
              className="w-full flex items-center justify-between px-4 py-2 min-h-[40px] text-left hover:bg-muted/40 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Formation</span>
                <span className="text-sm font-semibold text-foreground">
                  {formations[selectedFormation]?.name ?? "—"}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  openSection === "formation" && "rotate-180"
                )}
              />
            </button>
            {openSection === "formation" && (
              <div id="setup-section-formation" className="px-4 pb-2">
                <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-label="Formation">
                  {formations.map((f, i) => (
                    <button
                      key={i}
                      className={cn(
                        "flex-1 min-h-[44px] text-sm font-medium transition-colors",
                        i === selectedFormation
                          ? "bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted text-foreground"
                      )}
                      aria-label={`Formation ${f.name}`}
                      aria-pressed={i === selectedFormation}
                      onClick={() => handleFormationChange(i)}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Subs Speed — coaches can tune rotation cadence without leaving this screen. */}
          {typeof rotationSpeed === "number" && onRotationSpeedChange && (
            <div>
              <button
                type="button"
                onClick={() => toggleSection("subs")}
                aria-expanded={openSection === "subs"}
                aria-controls="setup-section-subs"
                className="w-full flex items-center justify-between px-4 py-2 min-h-[40px] text-left hover:bg-muted/40 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Subs Speed</span>
                  <span className="text-sm font-semibold text-foreground">{subsSpeedLabel}</span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    openSection === "subs" && "rotate-180"
                  )}
                />
              </button>
              {openSection === "subs" && (
                <div id="setup-section-subs" className="px-4 pb-2">
                  <div
                    className="flex rounded-lg border border-border overflow-hidden"
                    role="group"
                    aria-label="Subs speed"
                  >
                    {[
                      { value: 1, label: "Standard", Icon: List, hint: "Few subs, simple" },
                      { value: 2, label: "Frequent", Icon: Scale, hint: "2 subs / window" },
                    ].map(({ value, label, Icon, hint }) => {
                      const rs = rotationSpeed ?? 1;
                      const normalised = rs >= 2 ? 2 : 1;
                      const active = normalised === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          className={cn(
                            "flex-1 min-h-[44px] px-1 text-sm font-medium transition-colors flex flex-col items-center justify-center gap-0.5",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-background hover:bg-muted text-foreground"
                          )}
                          aria-label={`${label} subs speed — ${hint}`}
                          aria-pressed={active}
                          onClick={() => onRotationSpeedChange(value)}
                        >
                          <span className="flex items-center gap-1.5">
                            <Icon className="h-3.5 w-3.5" />
                            {label}
                          </span>
                          <span className={cn(
                            "text-[10px] leading-none",
                            active ? "text-primary-foreground/80" : "text-muted-foreground"
                          )}>
                            {hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Formation visual - mini pitch with color-coded slots */}
        <div className="sticky top-0 z-20 border-y border-border bg-background/95 backdrop-blur-sm">
          <div className="px-4 py-2">
            <div
              ref={pitchContainerRef}
              className="relative w-full aspect-[3/4] max-h-[30vh] rounded-lg mx-auto max-w-sm"
              style={{ backgroundColor: '#2d5a27' }}
              role="group"
              aria-label={`Formation pitch view, ${filledSlots} of ${totalSlots} positions filled`}
            >
              {/* Pitch lines */}
              <div className="absolute inset-[8%] border-2 border-white/30 rounded" />
              <div className="absolute left-[8%] right-[8%] top-[50%] h-[1px] bg-white/30" />
              <div className="absolute left-[25%] right-[25%] top-[8%] h-[18%] border-2 border-white/20 rounded-b" />
              <div className="absolute left-[25%] right-[25%] bottom-[8%] h-[18%] border-2 border-white/20 rounded-t" />

              {/* Formation slots - color-coded by position */}
              {slots.map((slot, i) => {
                const player = slot.assignedPlayerId ? getPlayerById(slot.assignedPlayerId) : null;
                const isSelected = selectedSlotIndex === i;
                const isHovered = hoveredSlotIndex === i && isDragging;
                const colors = CIRCLE_COLORS[slot.pitchPosition];

                return (
                  <button
                    key={i}
                    ref={el => { if (el) slotRefs.current.set(i, el); else slotRefs.current.delete(i); }}
                    className={cn(
                      "absolute w-14 h-14 -ml-7 -mt-7 rounded-full flex flex-col items-center justify-center transition-all text-white border-2",
                      player
                        ? cn(colors.filled, colors.filledBorder)
                        : isHovered
                          ? "bg-white/60 border-white scale-125 shadow-lg shadow-white/30"
                          : isSelected
                            ? "bg-white/40 border-white animate-pulse"
                            : isDragging && !player
                              ? cn(colors.empty, colors.emptyBorder, "border-dashed scale-110")
                              : cn(colors.empty, colors.emptyBorder, "border-dashed")
                    )}
                    style={{ left: `${slot.position.x}%`, top: `${slot.position.y}%`, transition: 'transform 150ms ease, background-color 150ms ease, box-shadow 150ms ease' }}
                    onClick={() => handleSlotTap(i)}
                    aria-label={player
                      ? `${slot.pitchPosition} position: ${player.name}. Tap to unassign`
                      : `Empty ${slot.pitchPosition} position. Tap to select`
                    }
                  >
                    {player ? (
                      <>
                        <span className="text-xs font-bold leading-none truncate max-w-[46px]">
                          {player.number || ""}
                        </span>
                        <span className="text-[9px] leading-none truncate max-w-[46px] mt-0.5">
                          {player.name.split(" ")[0]}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs font-bold text-white drop-shadow-sm">
                        {slot.pitchPosition}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-xs text-muted-foreground text-center" aria-live="polite">
              {isDragging
                ? "Drop on a position circle to assign"
                : selectedSlotIndex !== null
                  ? `Assigning: ${slots[selectedSlotIndex]?.pitchPosition || "position"} — tap another circle to switch`
                  : "Drag a player to a position, or tap to assign"}
            </p>
          </div>
        </div>

        {/* Player picker / GK rotation section */}
        <div className="border-t border-border">
          {/* GK Rotation toggle + 2nd half GK picker */}
          {hasGk && firstHalfGkId && (
            <div className="px-4 py-3 border-b border-border bg-muted/20 space-y-2.5">
              {/* 1st half GK display */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">1st Half GK:</span>
                  <span className="text-sm font-semibold text-foreground">
                    {getPlayerById(firstHalfGkId)?.name || "—"}
                  </span>
                </div>
              </div>

              {/* Rotate GK toggle */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-yellow-500" />
                  <Label htmlFor="rotate-gk-toggle" className="text-sm font-medium cursor-pointer">
                    Rotate GK at half-time
                  </Label>
                </div>
                <Switch
                  id="rotate-gk-toggle"
                  checked={rotateGk}
                  onCheckedChange={(checked) => {
                    setRotateGk(checked);
                    if (!checked) setSecondHalfGkId(null);
                  }}
                />
              </div>

              {/* 2nd half GK picker - shown when toggle is on */}
              {rotateGk && (
                <div className="space-y-1.5 pl-1">
                  <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                    2nd Half GK {!secondHalfGkId && effective2ndHalfGkId ? "(auto-picked)" : ""}
                  </p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select 2nd half goalkeeper">
                    {gkCapablePlayers.filter(p => p.id !== firstHalfGkId).map(p => {
                      const isSelected = effective2ndHalfGkId === p.id;
                      const isAutoSelected = !secondHalfGkId && autoSecondHalfGk?.id === p.id;
                      return (
                        <button
                          key={p.id}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full px-2.5 min-h-[38px] text-sm font-medium border transition-all",
                            isSelected
                              ? "bg-yellow-600/90 border-yellow-400/70 text-white shadow-sm"
                              : "bg-background border-border text-foreground hover:bg-muted/50 active:bg-muted/70"
                          )}
                          aria-label={`Select ${p.name} as 2nd half goalkeeper${isAutoSelected ? ' (auto-selected)' : ''}`}
                          aria-pressed={isSelected}
                          onClick={() => setSecondHalfGkId(p.id === secondHalfGkId ? null : p.id)}
                        >
                          <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                            {p.number || "#"}
                          </span>
                          {p.name.split(" ")[0]}
                          {isSelected && <Check className="h-3 w-3 ml-0.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Player list header */}
          <div className="px-4 py-2 flex items-center justify-between">
            <p className="text-sm font-medium">
              {selectedSlotIndex !== null
                ? `Pick player for ${slots[selectedSlotIndex]?.pitchPosition}`
                : "Tap or drag players to assign"
              }
            </p>
            <div className="flex gap-1.5">
              {(() => {
                const hasAssignments = slots.some(s => s.assignedPlayerId);
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 text-sm px-3"
                    onClick={handleAutoFill}
                    disabled={hasAssignments}
                    aria-label="Auto-fill all positions"
                    title={hasAssignments ? "Clear assignments first to auto-fill" : undefined}
                  >
                    <Zap className="h-4 w-4 mr-1" />
                    Auto
                  </Button>
                );
              })()}
              <Button variant="ghost" size="sm" className="h-11 text-sm px-3" onClick={handleClearAll} aria-label="Clear all assigned players">
                <RotateCcw className="h-4 w-4 mr-1" />
                Clear
              </Button>
            </div>
          </div>

          {/* Player list - inline, scrolls with page */}
          <div className="px-4 pb-4 space-y-1">
            {filteredBenchPlayers.length === 0 && selectedSlotIndex !== null ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                All players assigned! Tap an occupied position to swap.
              </p>
            ) : filteredBenchPlayers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No available players
              </p>
            ) : (
              filteredBenchPlayers.map(player => {
                const selectedSlot = selectedSlotIndex !== null ? slots[selectedSlotIndex] : null;
                const isEligible = selectedSlot ? canPlayPosition(player, selectedSlot.pitchPosition) : true;
                const isBeingDragged = dragState?.playerId === player.id && isDragging;

                return (
                  <div
                    key={player.id}
                    className={cn(
                      "w-full flex items-center justify-between p-2.5 min-h-[48px] rounded-lg border transition-all text-left select-none",
                      isBeingDragged
                        ? "border-primary bg-primary/10 opacity-50"
                        : selectedSlotIndex === null
                          ? "border-border bg-muted/30 hover:bg-muted/50 active:bg-muted/70"
                          : isEligible
                            ? "border-primary/30 bg-primary/5 hover:bg-primary/10 active:bg-primary/20"
                            : "border-border bg-muted/30 opacity-50"
                    )}
                    style={{ touchAction: 'auto' }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${player.name}, number ${player.number || 'unassigned'}${player.assignedPositions?.length ? `, plays ${player.assignedPositions.join(', ')}` : ', any position'}${!isEligible && selectedSlotIndex !== null ? ', not eligible for this position' : ''}. Drag to a position or tap to assign.`}
                    onClick={() => {
                      if (suppressClickRef.current || dragState) return;
                      handlePickPlayer(player.id);
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      // Don't capture pointer - let scroll happen until direction is determined
                      handleDragStart(player.id, e.clientX, e.clientY);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handlePickPlayer(player.id);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                        {player.number || "#"}
                      </div>
                      <div>
                        <p className="text-sm font-medium leading-tight">{player.name}</p>
                        <div className="flex gap-1 mt-0.5">
                          {player.assignedPositions?.length ? (
                            player.assignedPositions.map(pos => {
                              const posColors = POSITION_COLORS[pos];
                              return (
                                <span key={pos} className={cn("text-[9px] font-bold px-1 py-0.5 rounded", posColors.bg, posColors.text)}>
                                  {pos}
                                </span>
                              );
                            })
                          ) : (
                            <span className="text-[9px] text-muted-foreground">Any position</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {selectedSlotIndex !== null && isEligible && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                      <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border flex gap-2 shrink-0" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}>
        <Button
          className="flex-1"
          onClick={handleConfirm}
          disabled={filledSlots < totalSlots}
        >
          <Check className="h-4 w-4 mr-1.5" />
          Confirm Lineup ({filledSlots}/{totalSlots})
        </Button>
      </div>

      {/* Drag ghost - floating element that follows the finger */}
      {isDragging && draggedPlayer && (
        <div
          className="fixed z-[999999] pointer-events-none"
          style={{
            left: dragState!.ghostX,
            top: dragState!.ghostY,
            transform: 'translate(-50%, -80%)',
          }}
        >
          <div className="flex items-center gap-2 bg-background/95 backdrop-blur-sm border-2 border-primary rounded-full px-3 py-2 shadow-2xl shadow-primary/20">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
              {draggedPlayer.number || "#"}
            </div>
            <span className="text-sm font-semibold text-foreground whitespace-nowrap">
              {draggedPlayer.name}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
