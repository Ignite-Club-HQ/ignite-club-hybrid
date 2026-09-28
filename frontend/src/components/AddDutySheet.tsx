import { useState, useMemo } from "react";
import { Loader2, Utensils, Flag, PaintBucket, Megaphone, FileText, UserCog, Apple, Cookie, ShieldCheck, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { isSoccerSport } from "@/lib/sportDetection";

// All duty options with their metadata
const ALL_DUTY_OPTIONS = [
  { id: "Canteen/BBQ", label: "Canteen/BBQ", icon: Utensils, description: "Food & drinks" },
  { id: "Linesperson", label: "Linesperson", icon: Flag, description: "Line calls" },
  { id: "Linemarker", label: "Linemarker", icon: PaintBucket, description: "Mark the pitch" },
  { id: "Referee", label: "Referee", icon: Megaphone, description: "Officiate the game" },
  { id: "Umpire", label: "Umpire", icon: Megaphone, description: "Officiate the game" },
  { id: "Scorer", label: "Scorer", icon: ClipboardList, description: "Keep the score" },
  { id: "Subs Manager", label: "Subs Manager", icon: UserCog, description: "Pitch board access" },
  { id: "Game Steward", label: "Game Steward", icon: ShieldCheck, description: "Ground safety & conduct" },
  { id: "Oranges", label: "Oranges", icon: Apple, description: "Half-time oranges" },
  { id: "Snacks", label: "Snacks", icon: Cookie, description: "Snacks & treats" },
  { id: "custom", label: "Other", icon: FileText, description: "Custom duty" },
];

/**
 * Sport-specific officiating duties. Linesperson / Referee / Subs Manager are
 * soccer-family concepts (and Subs Manager grants pitch-board access, which is
 * a football board); every other sport gets Umpire + Scorer instead. Anything
 * else is still reachable through "Other".
 */
const SOCCER_ONLY_DUTIES = new Set(["Linesperson", "Referee", "Subs Manager"]);
const NON_SOCCER_ONLY_DUTIES = new Set(["Umpire", "Scorer"]);

// Duties that support optional timed shifts (multiple slots throughout the event)
const SHIFT_CAPABLE_DUTIES = new Set(["Canteen/BBQ"]);

// For mini league session level: all duties available (auto-distributed to matches)
const MINI_LEAGUE_SESSION_DUTIES = ["Canteen/BBQ", "Linemarker", "Referee", "Linesperson", "Subs Manager", "Game Steward", "Umpire", "Scorer", "Oranges", "Snacks", "custom"];

// For mini league match level: only Referee and Linesperson
const MINI_LEAGUE_MATCH_DUTIES = ["Linesperson", "Referee", "Subs Manager", "Umpire", "Scorer", "Oranges", "Snacks"];

export type DutyContext = "session" | "match";

export interface AddDutyOptions {
  startTime?: string; // HH:MM (local)
  endTime?: string;   // HH:MM (local)
}

interface AddDutySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddDuty: (dutyName: string, opts?: AddDutyOptions) => void;
  isPending: boolean;
  /** Whether this is for a mini league event */
  isMiniLeague?: boolean;
  /** Context: session (event level) or match (group level) */
  context?: DutyContext;
  /**
   * Club sport. Soccer-family sports get Referee / Linesperson / Subs Manager;
   * every other sport gets Umpire / Scorer instead. Undefined = treat as
   * soccer (mini-league / football-only surfaces).
   */
  sport?: string | null;
}

export function AddDutySheet({ 
  open, 
  onOpenChange, 
  onAddDuty, 
  isPending,
  isMiniLeague = false,
  context = "session",
  sport,
}: AddDutySheetProps) {
  const [selectedDuty, setSelectedDuty] = useState<string>("");
  const [customDutyName, setCustomDutyName] = useState("");
  const [shiftStart, setShiftStart] = useState("");
  const [shiftEnd, setShiftEnd] = useState("");

  // Determine which duties to show based on context + sport
  const dutyOptions = useMemo(() => {
    // `sport === undefined` (never fetched) keeps the historical soccer set.
    const soccerFamily = sport === undefined ? true : isSoccerSport(sport);
    const bySport = ALL_DUTY_OPTIONS.filter((duty) =>
      soccerFamily ? !NON_SOCCER_ONLY_DUTIES.has(duty.id) : !SOCCER_ONLY_DUTIES.has(duty.id)
    );

    if (!isMiniLeague) return bySport;

    // Mini league events: filter based on context
    const allowedIds = context === "match" 
      ? MINI_LEAGUE_MATCH_DUTIES 
      : MINI_LEAGUE_SESSION_DUTIES;
    
    return bySport.filter(duty => allowedIds.includes(duty.id));
  }, [isMiniLeague, context, sport]);

  const showShiftFields = SHIFT_CAPABLE_DUTIES.has(selectedDuty);

  const handleSubmit = () => {
    const opts: AddDutyOptions | undefined = showShiftFields && (shiftStart || shiftEnd)
      ? { startTime: shiftStart || undefined, endTime: shiftEnd || undefined }
      : undefined;
    if (selectedDuty === "custom") {
      if (customDutyName.trim()) {
        onAddDuty(customDutyName.trim());
      }
    } else if (selectedDuty) {
      onAddDuty(selectedDuty, opts);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Reset state when closing
      setSelectedDuty("");
      setCustomDutyName("");
      setShiftStart("");
      setShiftEnd("");
    }
    onOpenChange(isOpen);
  };

  const isSubmitDisabled =
    !selectedDuty ||
    (selectedDuty === "custom" && !customDutyName.trim()) ||
    (showShiftFields && shiftStart && shiftEnd && shiftEnd <= shiftStart) ||
    isPending;

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add Duty</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            {dutyOptions.map((duty) => {
              const Icon = duty.icon;
              const isSelected = selectedDuty === duty.id;
              
              return (
                <button
                  key={duty.id}
                  type="button"
                  onClick={() => setSelectedDuty(duty.id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all",
                    "min-h-[100px] touch-manipulation",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:border-primary/50 hover:bg-accent"
                  )}
                >
                  <div className={cn(
                    "p-3 rounded-full transition-colors",
                    isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-center">
                    <p className={cn(
                      "font-medium text-sm",
                      isSelected ? "text-primary" : "text-foreground"
                    )}>
                      {duty.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{duty.description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedDuty === "custom" && (
            <div className="space-y-2 pt-2">
              <Label htmlFor="customDutyName">Custom Duty Name</Label>
              <Input
                id="customDutyName"
                value={customDutyName}
                onChange={(e) => setCustomDutyName(e.target.value)}
                placeholder="e.g. BBQ, Scorer, First Aid"
                className="h-12 text-base"
                autoFocus
              />
            </div>
          )}

          {showShiftFields && (
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-sm">Shift time (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Add multiple Canteen/BBQ duties to split the day into shifts (e.g. 9:00–10:30, 10:30–12:00).
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="shiftStart" className="text-xs text-muted-foreground">Start</Label>
                  <Input
                    id="shiftStart"
                    type="time"
                    value={shiftStart}
                    onChange={(e) => setShiftStart(e.target.value)}
                    className="h-12 text-base"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="shiftEnd" className="text-xs text-muted-foreground">End</Label>
                  <Input
                    id="shiftEnd"
                    type="time"
                    value={shiftEnd}
                    onChange={(e) => setShiftEnd(e.target.value)}
                    className="h-12 text-base"
                  />
                </div>
              </div>
              {shiftStart && shiftEnd && shiftEnd <= shiftStart && (
                <p className="text-xs text-destructive">End time must be after start time.</p>
              )}
            </div>
          )}
        </div>


        <ResponsiveDialogFooter className="gap-2 sm:gap-0 sticky bottom-0 bg-background pt-3 pb-[env(safe-area-inset-bottom,0px)] border-t">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="flex-1 sm:flex-none"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Add Duty
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
