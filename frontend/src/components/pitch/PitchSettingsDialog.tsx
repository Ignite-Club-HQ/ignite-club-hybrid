import { useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  ResponsiveDialog, 
  ResponsiveDialogContent, 
  ResponsiveDialogHeader, 
  ResponsiveDialogTitle 
} from "@/components/ui/responsive-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Settings, Users, Trash2, Settings2, Save, ChevronDown, CalendarCheck, EyeOff, SlidersHorizontal, List, UserPlus, Scale, Play, ClipboardList, Link2Off, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { TeamSize } from "./types";
import { exportTimerAuditLog } from "@/lib/timerAuditLog";
import { toast } from "@/hooks/use-toast";
import { PitchBoardNotifyRoleToggles } from "./PitchBoardNotifyRoleToggles";


interface Formation {
  name: string;
  positions: { x: number; y: number }[];
}

interface PitchSettingsDialogProps {
  
  // Formation
  selectedFormation: number;
  onFormationChange: (value: string) => void;
  formations: Formation[];
  
  // Team size
  teamSize: TeamSize;
  onTeamSizeChange: (size: TeamSize) => void;
  
  // Time per half
  minutesPerHalf: number;
  onMinutesPerHalfChange: (minutes: number) => void;
  
  // Rotation speed (subs speed)
  rotationSpeed: number;
  onRotationSpeedChange: (speed: number) => void;
  
  // Disable position swaps in auto sub generation
  disablePositionSwaps?: boolean;
  onDisablePositionSwapsChange?: (disabled: boolean) => void;
  
  // Disable batch subs (multiple at once)
  disableBatchSubs?: boolean;
  onDisableBatchSubsChange?: (disabled: boolean) => void;
  
  // Rotate GK at halftime
  rotateGkAtHalftime?: boolean;
  onRotateGkAtHalftimeChange?: (enabled: boolean) => void;

  // Max acceptable playing-time spread (minutes). Used by auto-sub planner.
  maxSpreadMinutes?: number;
  onMaxSpreadMinutesChange?: (minutes: number) => void;
  
  // Player position preference
  onOpenPositionEditor: () => void;
  
  // Mock data
  mockMode: boolean;
  onMockModeChange: (enabled: boolean) => void;
  
  // Read-only mode
  readOnly?: boolean;
  
  // Game in progress
  gameInProgress?: boolean;
  gameTimerRunning?: boolean;
  gameFinished?: boolean;
  
  // Optional trigger button customization
  triggerClassName?: string;
  
  // External open control (no trigger button rendered when provided)
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  
  // Hide trigger button (when using external control)
  hideTrigger?: boolean;
  
  // Reset game
  onResetGame?: () => void;

  // Unlink current match/game event without resetting the board
  linkedEventId?: string | null;
  onUnlinkEvent?: () => void;
  
  // Reset formation (players + ball to default positions)
  onResetFormation?: () => void;
  
  // Match stats
  onOpenStats?: () => void;

  // Manual finalisation: save stats regardless of timer state
  onEndGameAndSave?: () => void;

  
  // Save settings
  onSaveSettings?: () => void;
  isSaving?: boolean;
  
  // Match header toggle
  showMatchHeader?: boolean;
  onShowMatchHeaderChange?: (show: boolean) => void;
  
  // Hide scores toggle
  hideScores?: boolean;
  onHideScoresChange?: (hide: boolean) => void;
  
  // Show lineup picker at game start
  showLineupPicker?: boolean;
  onShowLineupPickerChange?: (show: boolean) => void;
  
  // Manual trigger lineup picker
  onOpenLineupPicker?: () => void;
  
  // Add fill-in player
  onAddFillInPlayer?: () => void;

  // Team id — used for per-role pitch board notification toggles.
  teamId?: string;
}


export function PitchSettingsDialog({
  selectedFormation,
  onFormationChange,
  formations,
  teamSize,
  onTeamSizeChange,
  minutesPerHalf,
  onMinutesPerHalfChange,
  rotationSpeed,
  onRotationSpeedChange,
  disablePositionSwaps = false,
  onDisablePositionSwapsChange,
  disableBatchSubs = false,
  onDisableBatchSubsChange,
  rotateGkAtHalftime = true,
  onRotateGkAtHalftimeChange,
  maxSpreadMinutes = 5,
  onMaxSpreadMinutesChange,
  onOpenPositionEditor,
  mockMode,
  onMockModeChange,
  readOnly = false,
  gameInProgress = false,
  gameTimerRunning = false,
  gameFinished = false,
  triggerClassName,
  externalOpen,
  onExternalOpenChange,
  hideTrigger = false,
  onResetGame,
  linkedEventId,
  onUnlinkEvent,
  onResetFormation,
  onOpenStats,
  onEndGameAndSave,

  onSaveSettings,
  isSaving = false,
  showMatchHeader,
  onShowMatchHeaderChange,
  hideScores = false,
  onHideScoresChange,
  showLineupPicker = false,
  onShowLineupPickerChange,
  onOpenLineupPicker,
  onAddFillInPlayer,
  teamId,
}: PitchSettingsDialogProps) {

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetFormationConfirmOpen, setResetFormationConfirmOpen] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = onExternalOpenChange || setInternalOpen;
  
  return (
    <>
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <Button 
          variant="outline" 
          size="icon" 
          className={cn("h-10 w-10", triggerClassName)}
          onClick={() => setOpen(true)}
        >
          <Settings className="h-5 w-5" />
        </Button>
      )}
        <ResponsiveDialogContent 
          className="z-[1000001] max-h-[85vh] sm:max-h-[80vh] flex flex-col"
        >
          <ResponsiveDialogHeader className="shrink-0 pb-2">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Game Setup
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          
          <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0 -mx-1 px-1">
            {/* Primary: Team Size + Formation - the only thing new users need */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Players per Side</Label>
                  <Select 
                    value={teamSize} 
                    onValueChange={(v) => onTeamSizeChange(v as TeamSize)}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-10" data-vaul-no-drag>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[1000010] bg-popover" data-vaul-no-drag>
                      <SelectItem value="3">3-a-side</SelectItem>
                      <SelectItem value="4">4-a-side</SelectItem>
                      <SelectItem value="5">5-a-side</SelectItem>
                      <SelectItem value="7">7-a-side</SelectItem>
                      <SelectItem value="9">9-a-side</SelectItem>
                      <SelectItem value="11">11-a-side</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Formation</Label>
                  <Select 
                    value={selectedFormation.toString()} 
                    onValueChange={onFormationChange}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-10" data-vaul-no-drag>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[1000010] bg-popover" data-vaul-no-drag>
                      {formations.map((f, i) => (
                        <SelectItem key={i} value={i.toString()}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Time per Half</Label>
                  <Select 
                    value={minutesPerHalf.toString()} 
                    onValueChange={(v) => onMinutesPerHalfChange(parseInt(v))}
                    disabled={readOnly || gameInProgress}
                  >
                    <SelectTrigger className="h-10" data-vaul-no-drag>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[1000010] bg-popover" data-vaul-no-drag>
                      <SelectItem value="5">5 min</SelectItem>
                      <SelectItem value="10">10 min</SelectItem>
                      <SelectItem value="15">15 min</SelectItem>
                      <SelectItem value="20">20 min</SelectItem>
                      <SelectItem value="25">25 min</SelectItem>
                      <SelectItem value="30">30 min</SelectItem>
                      <SelectItem value="35">35 min</SelectItem>
                      <SelectItem value="40">40 min</SelectItem>
                      <SelectItem value="45">45 min</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Subs Speed</Label>
                  <Select 
                    value={(rotationSpeed >= 2 ? 2 : 1).toString()} 
                    onValueChange={(v) => onRotationSpeedChange(parseInt(v))}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-10" data-vaul-no-drag>
                      <SelectValue>
                        {rotationSpeed >= 2 ? 'Frequent' : 'Standard'}
                      </SelectValue>
                    </SelectTrigger>
                     <SelectContent className="z-[1000010] bg-popover" data-vaul-no-drag>
                      <SelectItem value="1">
                        <div className="flex items-center gap-2">
                          <List className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <div>
                            <span>Standard</span>
                            <p className="text-[10px] text-muted-foreground">Fewer subs, simple rotation, fair for everyone</p>
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="2">
                        <div className="flex items-center gap-2">
                          <Scale className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <div>
                            <span>Frequent</span>
                            <p className="text-[10px] text-muted-foreground">2 subs per window — tighter time balance</p>
                          </div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {rotationSpeed === 1
                  ? `Subs roughly every 7 min — minimal disruption`
                  : `Subs every ~${Math.round(minutesPerHalf / 3)} min`}
              </p>

              {onMaxSpreadMinutesChange && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-xs text-muted-foreground">Max Playing-Time Spread</Label>
                  <Select
                    value={maxSpreadMinutes.toString()}
                    onValueChange={(v) => onMaxSpreadMinutesChange(parseInt(v))}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-10" data-vaul-no-drag>
                      <SelectValue>{maxSpreadMinutes} min</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="z-[1000010] bg-popover" data-vaul-no-drag>
                      <SelectItem value="3">3 min — strict fairness</SelectItem>
                      <SelectItem value="5">5 min — recommended</SelectItem>
                      <SelectItem value="7">7 min — relaxed</SelectItem>
                      <SelectItem value="10">10 min — queue-first</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Subs follow queue order; fairness only overrides queue once the projected gap between most & least played would exceed this cap.
                  </p>
                </div>
              )}
            </div>

            {/* Advanced Options - collapsed by default */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>More Options</span>
                </div>
                <ChevronDown className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  advancedOpen && "rotate-180"
                )} />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                {/* Match display toggles */}
                {!readOnly && onShowMatchHeaderChange && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="show-match-header-toggle" className="text-sm">
                        Show Match Header
                      </Label>
                    </div>
                    <Switch
                      id="show-match-header-toggle"
                      checked={showMatchHeader}
                      onCheckedChange={onShowMatchHeaderChange}
                    />
                  </div>
                )}
                
                {!readOnly && onHideScoresChange && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="hide-scores-toggle" className="text-sm">
                        Hide Scores
                      </Label>
                    </div>
                    <Switch
                      id="hide-scores-toggle"
                      checked={hideScores}
                      onCheckedChange={onHideScoresChange}
                    />
                  </div>
                )}

                {/* Substitution toggles */}
                {!readOnly && onDisableBatchSubsChange && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="disable-batch-toggle" className="text-sm">
                        Single Subs Only
                      </Label>
                      <span className="text-[10px] text-muted-foreground">One sub at a time</span>
                    </div>
                    <Switch
                      id="disable-batch-toggle"
                      checked={disableBatchSubs}
                      onCheckedChange={onDisableBatchSubsChange}
                    />
                  </div>
                )}
                {!readOnly && onDisablePositionSwapsChange && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="disable-swaps-toggle" className="text-sm">
                        Lock Positions
                      </Label>
                      <span className="text-[10px] text-muted-foreground">Keep players in assigned positions</span>
                    </div>
                    <Switch
                      id="disable-swaps-toggle"
                      checked={disablePositionSwaps}
                      onCheckedChange={onDisablePositionSwapsChange}
                    />
                  </div>
                )}
                
                {/* Rotate GK at halftime toggle */}
                {!readOnly && onRotateGkAtHalftimeChange && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="rotate-gk-toggle" className="text-sm">
                        Rotate GK at Halftime
                      </Label>
                      <span className="text-[10px] text-muted-foreground">Swap goalkeeper at half-time</span>
                    </div>
                    <Switch
                      id="rotate-gk-toggle"
                      checked={rotateGkAtHalftime}
                      onCheckedChange={onRotateGkAtHalftimeChange}
                    />
                  </div>
                )}

                {/* Show lineup picker at game start */}
                {!readOnly && onShowLineupPickerChange && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="lineup-picker-toggle" className="text-sm">
                        Starting Lineup Screen
                      </Label>
                      <span className="text-[10px] text-muted-foreground">Show lineup picker each game</span>
                    </div>
                    <Switch
                      id="lineup-picker-toggle"
                      checked={showLineupPicker}
                      onCheckedChange={onShowLineupPickerChange}
                    />
                  </div>
                )}


                {/* Mock data toggle */}
                {!readOnly && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="mock-toggle" className="text-sm">Mock Data</Label>
                    </div>
                    <Switch
                      id="mock-toggle"
                      checked={mockMode}
                      onCheckedChange={onMockModeChange}
                    />
                  </div>
                )}

                {/* Per-role pitch board notification toggles */}
                {!readOnly && teamId && (
                  <PitchBoardNotifyRoleToggles teamId={teamId} readOnly={readOnly} />
                )}

                {/* Export timer audit log */}

                <button
                  type="button"
                  className="w-full flex items-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={async () => {
                    const r = await exportTimerAuditLog();
                    toast({
                      title: r.ok ? (r.method === "clipboard" ? "Copied to clipboard" : "Timer log exported") : "Export failed",
                      description: r.ok && r.method === "download" ? "Saved as a .txt file" : r.ok ? "Paste into a message to share" : "Could not export the log",
                    });
                  }}
                >
                  <Download className="h-4 w-4" />
                  Export Timer Log
                </button>
              </CollapsibleContent>
            </Collapsible>
          </div>
          
          {/* Footer - minimal actions */}
          <div className="pt-3 border-t border-border shrink-0 space-y-2">
            {/* Primary actions - compact grid */}
            {!readOnly && (onSaveSettings || onOpenLineupPicker) && (
              <div className="grid grid-cols-2 gap-2">
                {onSaveSettings && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="h-9 text-xs gap-1.5"
                    onClick={() => {
                      onSaveSettings();
                      setOpen(false);
                    }}
                    disabled={isSaving}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                )}
                {onOpenLineupPicker && (
                  <Button 
                    variant="default" 
                    size="sm"
                    className="h-9 text-xs gap-1.5"
                    disabled={gameInProgress && gameTimerRunning && !gameFinished}
                    onClick={() => {
                      onOpenLineupPicker();
                      setOpen(false);
                    }}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Setup Game
                  </Button>
                )}
              </div>
            )}

            {/* Quick action row */}
            <div className="flex gap-2">
              {!readOnly && (
                <Button 
                  variant="outline" 
                  size="sm"
                  className="flex-1 h-9 text-xs"
                  onClick={() => {
                    onOpenPositionEditor();
                    setOpen(false);
                  }}
                >
                  <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                  Positions
                </Button>
              )}
              {!readOnly && onAddFillInPlayer && (
                <Button 
                  variant="outline" 
                  size="sm"
                  className="flex-1 h-9 text-xs"
                  onClick={() => {
                    onAddFillInPlayer();
                    setOpen(false);
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                  Fill-In
                </Button>
              )}
            </div>

            {/* Manual finalisation — works at any timer state so a coach who
                pauses or closes the app can still persist the session. */}
            {!readOnly && onEndGameAndSave && (
              <Button
                size="sm"
                className="w-full h-9"
                onClick={() => {
                  onEndGameAndSave();
                  setOpen(false);
                }}
              >
                <ClipboardList className="h-3.5 w-3.5 mr-2" />
                End game &amp; save stats
              </Button>
            )}



            {/* Danger zone - collapsed */}
            {!readOnly && (onResetFormation || onResetGame || (linkedEventId && onUnlinkEvent)) && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center justify-center w-full py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors gap-1">
                  <span>Reset Options</span>
                  <ChevronDown className="h-3 w-3" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-1">
                  {linkedEventId && onUnlinkEvent && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="w-full h-9"
                      onClick={() => {
                        onUnlinkEvent();
                        setOpen(false);
                      }}
                    >
                      <Link2Off className="h-3.5 w-3.5 mr-2" />
                      Unlink from Game
                    </Button>
                  )}
                  {onResetGame && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="w-full h-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setResetConfirmOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Reset Game
                    </Button>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </ResponsiveDialogContent>
    </ResponsiveDialog>
    
    {/* Reset Game Confirmation */}
    <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
      <AlertDialogContent className="z-[999999]">
        <AlertDialogHeader>
          <AlertDialogTitle>Reset Game?</AlertDialogTitle>
          <AlertDialogDescription>
            This will reset the timer, all player positions, and clear all substitution history. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              onResetGame?.();
              setResetConfirmOpen(false);
            }}
          >
            Reset Game
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    
    {/* Reset Formation Confirmation */}
    <AlertDialog open={resetFormationConfirmOpen} onOpenChange={setResetFormationConfirmOpen}>
      <AlertDialogContent className="z-[999999]">
        <AlertDialogHeader>
          <AlertDialogTitle>Reset Formation?</AlertDialogTitle>
          <AlertDialogDescription>
            This will move all players back to their default formation positions. Timer and stats will not be affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            onResetFormation?.();
            setResetFormationConfirmOpen(false);
          }}>
            Reset Formation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
