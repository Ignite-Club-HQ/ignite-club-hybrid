import { memo, CSSProperties } from "react";
import { cn } from "@/lib/utils";
import PositionBadge, { PitchPosition, POSITION_COLORS } from "./PositionBadge";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isInjured?: boolean;
  isFillIn?: boolean;
  teamSide?: "a" | "b"; // For mini-league two-team mode
}

interface PlayerTokenProps {
  player: Player;
  onDragStart: (e?: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onInjuryToggle?: () => void;
  onRemoveFillIn?: () => void;
  isDragging: boolean;
  isSelected?: boolean;
  isSubTarget?: boolean;
  isInvalidTarget?: boolean;
  isMovable?: boolean;
  isPreviewHighlight?: boolean;
  previewHighlightType?: "source" | "target" | null;
  subAnimation?: "in" | "out" | "swap" | null;
  variant?: "pitch" | "bench";
  style?: CSSProperties;
  readOnly?: boolean;
  // Mini-league team colors
  teamColor?: string;
  // Auto-sub next player highlight
  isNextSub?: boolean;
  nextSubCountdown?: string | null;
  // Sub is due NOW - strong pulse
  isSubDue?: boolean;
}

const PlayerToken = memo(function PlayerToken({
  player, 
  onDragStart, 
  onDragEnd,
  onTouchStart,
  onClick,
  onDoubleClick,
  onInjuryToggle,
  onRemoveFillIn,
  isDragging,
  isSelected = false,
  isSubTarget = false,
  isInvalidTarget = false,
  isMovable = false,
  isPreviewHighlight = false,
  previewHighlightType = null,
  subAnimation = null,
  variant = "pitch",
  style,
  readOnly = false,
  teamColor,
  isNextSub = false,
  nextSubCountdown = null,
  isSubDue = false
}: PlayerTokenProps) {
  const initials = player.name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const currentPosColors = player.currentPitchPosition 
    ? POSITION_COLORS[player.currentPitchPosition] 
    : null;

  // Format seconds as minutes (rounded)
  const formatMinutesPlayed = (seconds?: number) => {
    if (seconds === undefined || seconds === null) return null;
    const mins = Math.floor(seconds / 60);
    return `${mins}'`;
  };

  const minutesDisplay = formatMinutesPlayed(player.minutesPlayed);

  if (variant === "bench") {
    // Build dynamic border style for team color
    const benchBorderStyle = teamColor && !isSelected && !isSubTarget && !isInvalidTarget && !subAnimation 
      ? { borderColor: teamColor, borderLeftWidth: '4px' } 
      : undefined;

    return (
      <div
        draggable={!readOnly && !player.isInjured}
        onDragStart={readOnly || player.isInjured ? undefined : (e) => {
          try {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", player.id);
          } catch {}
          onDragStart(e);
        }}
        onDragEnd={readOnly || player.isInjured ? undefined : onDragEnd}
        onTouchStart={readOnly ? undefined : onTouchStart}
        onClick={readOnly ? undefined : onClick}
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted border border-border transition-all select-none touch-manipulation w-full",
          !player.isInjured && "cursor-grab active:cursor-grabbing",
          player.isInjured && "opacity-60 cursor-default bg-destructive/10 border-destructive/30",
          isDragging && "opacity-50 scale-95",
          isSelected && "ring-2 ring-yellow-400 ring-offset-2 ring-offset-background",
          isSubTarget && !isSelected && !player.isInjured && "ring-2 ring-emerald-400 ring-offset-1 ring-offset-background animate-pulse",
          isInvalidTarget && "opacity-50 ring-2 ring-destructive/50",
          subAnimation === "in" && "animate-scale-in ring-2 ring-emerald-500 bg-emerald-500/20",
          subAnimation === "out" && "animate-fade-in ring-2 ring-orange-500 bg-orange-500/20",
          isSubDue && !isSelected && !subAnimation && "ring-2 ring-orange-500 ring-offset-1 ring-offset-background animate-pulse bg-orange-500/15 border-orange-400/50",
          isNextSub && !isSubDue && !isSelected && !isSubTarget && !subAnimation && "ring-2 ring-emerald-400 ring-offset-1 ring-offset-background bg-emerald-500/15 border-emerald-400/50",
          onClick && !player.isInjured && "cursor-pointer"
        )}
        style={{ ...style, ...benchBorderStyle }}
      >
        <div 
          className={cn(
            "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold relative",
            !teamColor && "bg-primary/20 text-primary",
            player.isInjured && "bg-destructive/20 text-destructive",
            isSelected && "bg-yellow-400 text-yellow-900",
            isSubTarget && !isSelected && "bg-emerald-400/30 text-emerald-300",
            subAnimation === "in" && "bg-emerald-500 text-white",
            subAnimation === "out" && "bg-orange-500 text-white"
          )}
          style={teamColor && !isSelected && !isSubTarget && !subAnimation && !player.isInjured ? {
            backgroundColor: `${teamColor}30`,
            color: teamColor,
          } : undefined}
        >
          {player.number || initials}
          {player.isInjured && (
            <span className="absolute -top-1 -right-1 text-[8px]">🏥</span>
          )}
          {/* Team badge for mini-league */}
          {player.teamSide && !player.isInjured && (
            <span 
              className="absolute -top-1 -right-1 text-[8px] font-bold px-0.5 rounded text-white"
              style={{ backgroundColor: teamColor }}
            >
              {player.teamSide === "a" ? "A" : "B"}
            </span>
          )}
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className={cn("text-xs font-medium truncate", player.isInjured && "text-destructive")}>{player.name}</span>
            {player.isFillIn && (
              <span className="text-[9px] font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1 rounded">FILL-IN</span>
            )}
            {player.isInjured && (
              <span className="text-[9px] font-medium text-destructive bg-destructive/10 px-1 rounded">INJ</span>
            )}
            {isNextSub && !player.isInjured && (
              <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 px-1 rounded animate-pulse">NEXT ON</span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {player.assignedPositions && player.assignedPositions.length > 0 && (
              <div className="flex gap-0.5">
                {player.assignedPositions.map(pos => (
                  <PositionBadge key={pos} position={pos} size="sm" />
                ))}
              </div>
            )}
            {minutesDisplay !== null && (
              <span className="text-[10px] font-medium text-primary ml-auto">{minutesDisplay}</span>
            )}
            {isNextSub && nextSubCountdown && (
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 ml-auto">⏱ {nextSubCountdown}</span>
            )}
          </div>
        </div>
        {subAnimation === "out" && (
          <span className="text-[10px] font-semibold text-orange-400 ml-auto">OFF</span>
        )}
        {onRemoveFillIn && player.isFillIn && !readOnly && player.position === null && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveFillIn();
            }}
            className="ml-auto p-1 rounded-full transition-colors bg-destructive/10 hover:bg-destructive/20 text-destructive"
            title="Remove fill-in player"
          >
            <span className="text-[10px]">✕</span>
          </button>
        )}
      </div>
    );
  }

  // Build dynamic inline style for team color when in mini-league mode
  // Only apply color-related styles to the token circle, NOT position/transform styles
  const tokenCircleStyle: CSSProperties = teamColor && !isSelected && !isSubTarget && !isInvalidTarget && !isMovable && !isPreviewHighlight && !subAnimation ? {
    borderColor: teamColor,
    backgroundColor: `${teamColor}20`, // 20% opacity
  } : {};

  return (
    <div
      data-player-id={player.id}
      data-player-variant="pitch"
      draggable={!readOnly}
      onDragStart={readOnly ? undefined : (e) => {
        try {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", player.id);
        } catch {}
        onDragStart(e);
      }}
      onDragEnd={readOnly ? undefined : onDragEnd}
      onTouchStart={readOnly ? undefined : onTouchStart}
      onClick={readOnly ? undefined : onClick}
      onDoubleClick={readOnly ? undefined : onDoubleClick}
      className={cn(
        "flex flex-col items-center select-none touch-none transition-[transform,opacity] duration-300 ease-out",
        !readOnly && "cursor-grab active:cursor-grabbing",
        readOnly && "cursor-default",
        isDragging && "opacity-50 scale-95",
        isSelected && "scale-110",
        isSubTarget && !isSelected && "animate-pulse",
        isMovable && !isSelected && "animate-pulse",
        subAnimation === "in" && "animate-scale-in",
        subAnimation === "swap" && "animate-scale-in",
        onClick && "cursor-pointer"
      )}
      style={style}
    >
      <div 
        className={cn(
          "w-10 h-10 rounded-full bg-background border-2 shadow-lg flex items-center justify-center text-sm font-bold relative transition-all duration-200",
          // Only apply position-based colors if NOT in mini-league team color mode
          !teamColor && currentPosColors ? `${currentPosColors.border} ${currentPosColors.text}` : "",
          !teamColor && !currentPosColors && "border-primary text-primary",
          !teamColor && !currentPosColors && "text-foreground",
          isSelected && "border-yellow-400 ring-2 ring-yellow-400 bg-yellow-100 text-yellow-900",
          isSubTarget && !isSelected && !isInvalidTarget && "border-emerald-400 ring-2 ring-emerald-400 bg-emerald-400/20 text-emerald-700 dark:text-emerald-300",
          isInvalidTarget && !isSelected && "opacity-40 border-muted-foreground/30",
          isMovable && !isSelected && "border-amber-400 ring-2 ring-amber-400 bg-amber-400/20 text-amber-700 dark:text-amber-300",
          isSubDue && !isSelected && !subAnimation && "border-orange-500 ring-4 ring-orange-500/60 bg-orange-500/30 animate-pulse",
          isPreviewHighlight && previewHighlightType === "source" && "border-orange-400 ring-4 ring-orange-400/60 bg-orange-400/30 scale-110 text-orange-700 dark:text-orange-300",
          isPreviewHighlight && previewHighlightType === "target" && "border-cyan-400 ring-4 ring-cyan-400/60 bg-cyan-400/30 scale-110 text-cyan-700 dark:text-cyan-300",
          subAnimation === "in" && "border-emerald-500 ring-4 ring-emerald-500/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
          subAnimation === "swap" && "border-blue-500 ring-4 ring-blue-500/50 bg-blue-500/20 text-blue-700 dark:text-blue-300"
        )}
        style={tokenCircleStyle}
      >
        {player.number || initials}
        {subAnimation === "in" && (
          <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[8px] font-bold px-1 rounded">ON</span>
        )}
        {subAnimation === "swap" && (
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-[8px] font-bold px-1 rounded">MOVE</span>
        )}
        {isPreviewHighlight && previewHighlightType === "source" && !subAnimation && (
          <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[8px] font-bold px-1 rounded animate-pulse">OFF</span>
        )}
        {isPreviewHighlight && previewHighlightType === "target" && !subAnimation && (
          <span className="absolute -top-1 -right-1 bg-cyan-500 text-white text-[8px] font-bold px-1 rounded animate-pulse">MOVE</span>
        )}
        {isSubDue && !subAnimation && !isPreviewHighlight && !isSelected && (
          <span className="absolute -bottom-1 -right-1 bg-orange-500 text-white text-[7px] font-bold px-0.5 rounded animate-pulse">SUB!</span>
        )}
        {isNextSub && !isSubDue && !subAnimation && !isPreviewHighlight && !isSelected && (
          <span className="absolute -bottom-1 -right-1 bg-orange-500 text-white text-[7px] font-bold px-0.5 rounded animate-pulse">OFF</span>
        )}
        {player.currentPitchPosition && !subAnimation && !isPreviewHighlight && (
          <span 
            className={cn(
              "absolute -top-1 -right-1 text-[8px] font-bold px-1 rounded border",
              !teamColor && currentPosColors?.bg,
              !teamColor && currentPosColors?.text,
              !teamColor && currentPosColors?.border
            )}
            style={teamColor ? { 
              backgroundColor: teamColor, 
              borderColor: teamColor,
              color: 'white' 
            } : undefined}
          >
            {player.teamSide ? (player.teamSide === "a" ? "A" : "B") : player.currentPitchPosition}
          </span>
        )}
      </div>
      <div className="flex flex-col items-center">
        <span className="text-[11px] font-medium bg-background/80 px-1 rounded mt-0.5 truncate max-w-16 text-foreground shadow-sm">
          {player.name.split(" ")[0]}
        </span>
        {minutesDisplay !== null && (
          <span className="text-[10px] font-semibold text-primary bg-background/90 px-1.5 rounded-full border border-primary/30">
            {minutesDisplay}
          </span>
        )}
        {isNextSub && nextSubCountdown && (
          <span className="text-[8px] font-medium text-orange-600 dark:text-orange-400 bg-background/90 px-1 rounded-full border border-orange-400/40">
            ⏱ {nextSubCountdown}
          </span>
        )}
      </div>
    </div>
  );
});

export default PlayerToken;
