import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScoreEntry {
  id: string;
  side: "home" | "away";
  points: number;
  at: number;
}

interface GameScoreboardProps {
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  /** Allowed point increments. Basketball: [1,2,3]. Netball: [1] (or [1,2]). */
  increments: number[];
  readOnly?: boolean;
  onScore: (side: "home" | "away", points: number) => void;
  onUndo: () => void;
  onRenameAway: (name: string) => void;
  canUndo: boolean;
  /** When true, scoring buttons disabled (e.g. game finished). */
  disabled?: boolean;
  /**
   * Compact pre-game variant: single horizontal row, no scoring controls.
   * Used before tipoff to keep focus on lineup setup.
   */
  compact?: boolean;
  className?: string;
}

/**
 * Single dominant scoreboard bar:
 *   [ HOME ]   12 — 8   [ AWAY ]
 *
 * Live mode: tap a score → opens a popover with +1/+2/+3 buttons.
 * No inline "VS", no inline undo (undo lives in the bottom action strip).
 * Pre-game (compact): same shape, scores at 0, no popover.
 */
const GameScoreboard = memo(function GameScoreboard({
  homeLabel,
  awayLabel,
  homeScore,
  awayScore,
  increments,
  readOnly = false,
  onScore,
  onRenameAway,
  disabled = false,
  compact = false,
  className,
}: GameScoreboardProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftAway, setDraftAway] = useState(awayLabel);
  const [scorePopover, setScorePopover] = useState<"home" | "away" | null>(null);

  const interactive = !readOnly && !disabled && !compact;

  const handleScore = (side: "home" | "away", pts: number) => {
    onScore(side, pts);
    setScorePopover(null);
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4 px-3 py-2 bg-card",
        className
      )}
      role="group"
      aria-label="Scoreboard"
    >
      {/* HOME */}
      <div className="flex flex-col items-center min-w-0 gap-0.5">
        <span
          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 truncate max-w-full"
          title={homeLabel}
        >
          {homeLabel}
        </span>
        <ScoreButton
          score={homeScore}
          interactive={interactive}
          open={scorePopover === "home"}
          onOpenChange={(o) => setScorePopover(o ? "home" : null)}
          onScore={(pts) => handleScore("home", pts)}
          increments={increments}
          ariaLabel={`Add points for ${homeLabel}`}
          align="center"
        />
      </div>

      {/* DASH (no "VS", no undo here) */}
      <span className="text-2xl font-light text-muted-foreground/60 px-1">—</span>

      {/* AWAY */}
      <div className="flex flex-col items-center min-w-0 gap-0.5">
        <div className="flex items-center gap-1 max-w-full">
          <span
            className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 truncate"
            title={awayLabel}
          >
            {awayLabel}
          </span>
          {!readOnly && !compact && (
            <Popover
              open={renameOpen}
              onOpenChange={(o) => {
                setRenameOpen(o);
                if (o) setDraftAway(awayLabel);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-4 w-4 -ml-0.5"
                  aria-label="Rename opponent"
                >
                  <Pencil className="h-2.5 w-2.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="start">
                <div className="flex flex-col gap-2">
                  <Input
                    value={draftAway}
                    onChange={(e) => setDraftAway(e.target.value)}
                    placeholder="Opponent name"
                    maxLength={24}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRenameAway(draftAway.trim() || "Opponent");
                        setRenameOpen(false);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      onRenameAway(draftAway.trim() || "Opponent");
                      setRenameOpen(false);
                    }}
                  >
                    Save
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <ScoreButton
          score={awayScore}
          interactive={interactive}
          open={scorePopover === "away"}
          onOpenChange={(o) => setScorePopover(o ? "away" : null)}
          onScore={(pts) => handleScore("away", pts)}
          increments={increments}
          ariaLabel={`Add points for ${awayLabel}`}
          align="center"
        />
      </div>
    </div>
  );
});

interface ScoreButtonProps {
  score: number;
  interactive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScore: (points: number) => void;
  increments: number[];
  ariaLabel: string;
  align: "left" | "right" | "center";
}

function ScoreButton({
  score,
  interactive,
  open,
  onOpenChange,
  onScore,
  increments,
  ariaLabel,
  align,
}: ScoreButtonProps) {
  const display = (
    <span
      className={cn(
        "text-6xl font-extrabold tabular-nums leading-none text-foreground landscape:text-7xl px-2 py-0.5 rounded-md",
        interactive &&
          "hover:bg-muted/40 active:bg-muted/60 active:scale-95 transition-all cursor-pointer"
      )}
      aria-live="polite"
    >
      {score}
    </span>
  );

  if (!interactive) {
    return display;
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-transparent border-0 p-0 m-0 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
          aria-label={ariaLabel}
        >
          {display}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-1.5"
        align={align === "right" ? "end" : align === "left" ? "start" : "center"}
        sideOffset={4}
      >
        <div className="flex items-center gap-1">
          {increments.map((pts) => (
            <Button
              key={pts}
              size="sm"
              className="h-12 min-w-14 px-3 text-lg font-bold"
              onClick={() => onScore(pts)}
              aria-label={`Add ${pts} point${pts === 1 ? "" : "s"}`}
            >
              +{pts}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default GameScoreboard;
