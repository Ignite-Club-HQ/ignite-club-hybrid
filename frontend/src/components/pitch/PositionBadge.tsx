import { memo } from "react";
import { cn } from "@/lib/utils";

export type PitchPosition = "GK" | "DEF" | "MID" | "FWD";

export const POSITION_COLORS: Record<PitchPosition, { bg: string; text: string; border: string }> = {
  GK: { bg: "bg-yellow-500/30 dark:bg-yellow-500/30", text: "text-yellow-700 dark:text-yellow-300", border: "border-yellow-500 dark:border-yellow-400" },
  DEF: { bg: "bg-blue-500/30 dark:bg-blue-500/30", text: "text-blue-700 dark:text-blue-300", border: "border-blue-500 dark:border-blue-400" },
  MID: { bg: "bg-emerald-500/30 dark:bg-emerald-500/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-500 dark:border-emerald-400" },
  FWD: { bg: "bg-red-500/40 dark:bg-red-500/40", text: "text-red-700 dark:text-red-300", border: "border-red-600 dark:border-red-400" },
};

export const POSITION_LABELS: Record<PitchPosition, string> = {
  GK: "Goalkeeper",
  DEF: "Defender",
  MID: "Midfielder",
  FWD: "Forward",
};

interface PositionBadgeProps {
  position: PitchPosition;
  size?: "sm" | "md";
  className?: string;
}

const PositionBadge = memo(function PositionBadge({ position, size = "sm", className }: PositionBadgeProps) {
  const colors = POSITION_COLORS[position];
  
  return (
    <span
      className={cn(
        "font-bold rounded border",
        colors.bg,
        colors.text,
        colors.border,
        size === "sm" ? "text-[8px] px-1 py-0.5" : "text-xs px-1.5 py-0.5",
        className
      )}
    >
      {position}
    </span>
  );
});

export default PositionBadge;
