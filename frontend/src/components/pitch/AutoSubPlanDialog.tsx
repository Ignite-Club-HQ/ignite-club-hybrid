import { useState, useMemo, useEffect, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Play, AlertTriangle, Loader2, X, ChevronDown, RotateCcw, Sliders, GripVertical, Info } from "lucide-react";
import { PlanStatusCard, PlanModeToggles } from "./PlanForecastSummary";
import { SortablePlayerMinutesRow, type PlayerTimeForecast } from "./PlayerMinutesPresentation";
import { cn } from "@/lib/utils";
import SubPlanEditor from "./SubPlanEditor";
import { AdvancedSettingsPanel } from "./AdvancedSettingsPanel";
import { ADV_DEFAULTS, type AutoSubAdvancedOverrides } from "./planner/advancedOverrides";
import {
  calculateTimeForecasts,
  normalizeRotationSpeed,
  calculateFairnessReport,
  type FairnessReport,
} from "./planner/analysis";
import { type PlanFix, buildPlanFixes, pickRecommendedFix } from "./planner/planFixes";
import { PlanFixSuggestions } from "./PlanFixSuggestions";
import { FairnessSimulatorPanel } from "./FairnessSimulatorPanel";
import { isPlanPlayableFromPlayers } from "./planner/validation";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  type Player,
  type SubstitutionEvent,
  type MiniLeagueTeams,
  createSubPlan,
  createMiniLeagueSubPlan,
} from "./planner/scheduler";

export { isPlanPlayableFromPlayers };

export { calculateTimeForecasts };
export type { PlayerTimeForecast } from "./PlayerMinutesPresentation";
export type { Player, SubstitutionEvent, MiniLeagueTeams } from "./planner/scheduler";
export { createSubPlan, createMiniLeagueSubPlan } from "./planner/scheduler";

/**
 * Swap two players' lineup positions (and currentPitchPosition snapshot).
 * Used by the priority-bias loop to actually move a higher-priority bench
 * player onto the pitch (and the displaced starter to the bench) so the
 * scheduler then redistributes minutes from the new lineup. Full-game GKs
 * are never passed in here — only outfielders.
 */
export function swapLineupPositions(players: Player[], idA: string, idB: string): Player[] {
  const A = players.find(p => p.id === idA);
  const B = players.find(p => p.id === idB);
  if (!A || !B) return players;
  return players.map(p => {
    if (p.id === idA) return { ...p, position: B.position, currentPitchPosition: B.currentPitchPosition };
    if (p.id === idB) return { ...p, position: A.position, currentPitchPosition: A.currentPitchPosition };
    return p;
  });
}

export type { AutoSubAdvancedOverrides } from "./planner/advancedOverrides";
export { normalizeRotationSpeed } from "./planner/analysis";

interface AutoSubPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Player[];
  teamSize: number;
  minutesPerHalf: number;
  onStartPlan: (plan: SubstitutionEvent[]) => void;
  existingPlan?: SubstitutionEvent[];
  editMode?: boolean;
  rotationSpeed?: number; // 1 = slow, 2 = medium, 3 = fast
  disablePositionSwaps?: boolean; // When true, skip position swaps in auto generation
  disableBatchSubs?: boolean; // When true, only do one sub at a time
  rotateGkAtHalftime?: boolean; // When true, swap GK at halftime
  /** Max acceptable playing-time spread (minutes). Planner stays in queue
   *  (FIFO) order while projected spread is within this cap; once projected
   *  to exceed it, fairness overrides queue. Defaults to 5 minutes. */
  maxSpreadMinutes?: number;
  currentElapsedSeconds?: number; // Current game elapsed seconds (for mid-game start)
  currentHalf?: 1 | 2; // Current half (for mid-game start)
  preferredSecondHalfGkId?: string; // Preferred 2nd half GK from lineup screen
  showStepper?: boolean; // Show the Lineup → Subs step indicator
  /** When provided alongside showStepper, the "Lineup" step becomes a button
   *  that closes the dialog and returns the user to the lineup picker. */
  onBackToLineup?: () => void;
  miniLeagueTeams?: MiniLeagueTeams; // When set, generate per-team plans
  /** Optional power-user overrides for planner thresholds. */
  advancedOverrides?: AutoSubAdvancedOverrides;
  /** Called when the priority-bias loop swaps players between starting and
   *  bench so the parent can sync its lineup before the plan runs. */
  onLineupChange?: (players: Player[]) => void;
}

function DialogInner({
  players, 
  teamSize, 
  minutesPerHalf, 
  onStartPlan,
  onClose,
  existingPlan,
  editMode,
  rotationSpeed = 2,
  disablePositionSwaps = false,
  disableBatchSubs = false,
  rotateGkAtHalftime = true,
  maxSpreadMinutes = 5,
  currentElapsedSeconds = 0,
  currentHalf = 1,
  preferredSecondHalfGkId,
  isSetupFlow = false,
  miniLeagueTeams,
  advancedOverrides,
  onLineupChange,
}: {
  players: Player[];
  teamSize: number;
  minutesPerHalf: number;
  onStartPlan: (plan: SubstitutionEvent[]) => void;
  onClose: () => void;
  existingPlan?: SubstitutionEvent[];
  editMode?: boolean;
  rotationSpeed?: number;
  disablePositionSwaps?: boolean;
  disableBatchSubs?: boolean;
  rotateGkAtHalftime?: boolean;
  maxSpreadMinutes?: number;
  currentElapsedSeconds?: number;
  currentHalf?: 1 | 2;
  preferredSecondHalfGkId?: string;
  isSetupFlow?: boolean;
  miniLeagueTeams?: MiniLeagueTeams;
  advancedOverrides?: AutoSubAdvancedOverrides;
  onLineupChange?: (players: Player[]) => void;
}) {
  const hasRemainingPlan = !!existingPlan?.some(s => !s.executed && !s.skipped);
  const isExistingPlanPlayable = hasRemainingPlan &&
    isPlanPlayableFromPlayers(players, existingPlan!, minutesPerHalf * 60);
  // In edit mode, always load the existing plan so the user can review/adjust
  // it — even if the lineup has drifted and made it technically unplayable.
  // In forecast mode, treat stale plans as none so auto-generation kicks in
  // (a stale plan would render bench players stuck on 0 minutes).
  const effectiveExistingPlan = editMode
    ? (hasRemainingPlan ? existingPlan : undefined)
    : (isExistingPlanPlayable ? existingPlan : undefined);
  const [plan, setPlan] = useState<SubstitutionEvent[] | null>(effectiveExistingPlan || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const activeTab: 'forecast' | 'edit' = editMode ? 'edit' : 'forecast';

  // ---- Advanced overrides (persisted) -----------------------------------
  // External `advancedOverrides` prop wins; otherwise we read/write our own
  // copy in localStorage so the panel survives reloads.
  // v2 storage key — bumped when the priority toggles were removed so any
  // leftover overrides from the deleted "Make minutes fairer" / "Fewer subs"
  // toggles don't keep starving bench players in Frequent mode.
  const ADV_STORAGE_KEY = "autoSubPlan.advancedOverrides.v2";
  const [localOverrides, setLocalOverrides] = useState<AutoSubAdvancedOverrides>(() => {
    if (advancedOverrides) return {};
    try {
      if (typeof window !== "undefined") {
        // One-time cleanup of the v1 key (priority-toggle leftovers).
        window.localStorage.removeItem("autoSubPlan.advancedOverrides.v1");
      }
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(ADV_STORAGE_KEY) : null;
      return raw ? JSON.parse(raw) as AutoSubAdvancedOverrides : {};
    } catch { return {}; }
  });
  const effectiveOverrides: AutoSubAdvancedOverrides = advancedOverrides ?? localOverrides;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Only ONE priority can be active at a time (mutually exclusive).
  // Picking another priority replaces the current one rather than stacking.
  const [activeFixId, setActiveFixId] = useState<string | null>(null);
  // Local override of rotation speed (Standard=1 / Frequent=2). Defaults to
  // the prop so the dialog opens in the coach's saved mode but can be
  // toggled in-dialog without leaving the planner.
  const normalizedPropMode: 1 | 2 = rotationSpeed === 1 ? 1 : 2;
  const [rotationSpeedOverride, setRotationSpeedOverride] = useState<1 | 2>(normalizedPropMode);
  const effectiveRotationSpeed: 1 | 2 = rotationSpeedOverride;
  // Snapshot of plan metrics from BEFORE the coach applied any priority, so
  // the impact preview can show before→after diffs.
  const baselineMetricsRef = useRef<{ totalSubs: number; spreadMin: number; shortShifts: number; hasHalftimeClash: boolean } | null>(null);
  const [showAllMinutes, setShowAllMinutes] = useState(true);
  const [showTimelinePreview, setShowTimelinePreview] = useState(true);
  // Fairness simulator: lazily computed on coach demand so the dialog stays
  // snappy. Cleared whenever the underlying plan changes.
  const [fairnessReport, setFairnessReport] = useState<FairnessReport | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  // Safeguard notice: set when Frequent mode would have left an outfield
  // player with 0 minutes and we silently fell back to Standard rotation.
  const [frequentFallbackNotice, setFrequentFallbackNotice] = useState<string | null>(null);
  // True when Frequent rotation can't fit every player into this match
  // length — drives a disabled Frequent toggle so the coach can't pick a
  // mode that would silently fall back to Standard.
  const [frequentBlocked, setFrequentBlocked] = useState(false);
  // Coach-supplied priority order — top of list = wants more minutes.
  // Soft bias only: nudges minutes among bench-rotation outfielders without
  // overriding fairness/short-shift rules. `null` = neutral (planner default).
  const [playerPriority, setPlayerPriority] = useState<string[] | null>(null);
  // Players after applying priority-bias position swaps. When the coach
  // drags a bench player above a starter, this view actually swaps their
  // positions so the planner — and its forecasts — reflect the new lineup.
  // Falls back to the input `players` when no bias is active.
  const [effectivePlayers, setEffectivePlayers] = useState<Player[]>(players);
  // PointerSensor with a small activation distance so taps on rows still
  // scroll naturally; only deliberate drags from the grip handle reorder.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const persistLocal = (next: AutoSubAdvancedOverrides) => {
    setLocalOverrides(next);
    try { window.localStorage.setItem(ADV_STORAGE_KEY, JSON.stringify(next)); } catch {}
  };

  /**
   * Apply a coach-facing priority. Mutually exclusive: resets overrides to
   * defaults first, then applies only this fix on top — so picking another
   * option replaces the current strategy rather than stacking on top of it.
   */
  const applyPlanFix = (fix: PlanFix) => {
    if (advancedOverrides) return;
    // Tapping the active toggle clears it back to recommended defaults.
    if (activeFixId === fix.id || fix.id === "reset-defaults") {
      persistLocal({});
      setActiveFixId(null);
      return;
    }
    persistLocal(fix.apply({}));
    setActiveFixId(fix.id);
  };

  
  // Effective max-spread: panel override (in seconds) wins over the prop.
  const effectiveMaxSpreadMinutes = effectiveOverrides.maxSpreadOverrideSec !== undefined
    ? effectiveOverrides.maxSpreadOverrideSec / 60
    : maxSpreadMinutes;

  /**
   * Build a plan from the given roster, with optional priority-bias position
   * swaps. When the coach has dragged players in the priority list, we run
   * an iterative loop: generate a plan, compute forecasts, and if a
   * higher-priority outfielder has materially fewer minutes (>1.5m) than a
   * lower-priority outfielder below them, physically swap their lineup
   * positions and regenerate. GKs (full-game) are pinned. Loops until
   * stable or 8 iterations to prevent runaway recalculation.
   *
   * Returns both the plan AND the player roster used to generate it so the
   * caller can mirror those position swaps to the parent's lineup before
   * the plan starts running.
   */
  const buildPlanFromRoster = (roster: Player[], speed: 1 | 2): { plan: SubstitutionEvent[]; roster: Player[] } => {
    const halfDurationSeconds = minutesPerHalf * 60;
    const planningOverrides: AutoSubAdvancedOverrides = playerPriority?.length
      ? { ...effectiveOverrides, playerPriorityOrder: playerPriority }
      : effectiveOverrides;
    const make = (rs: Player[]) => miniLeagueTeams
      ? createMiniLeagueSubPlan(rs, teamSize, halfDurationSeconds, speed, disablePositionSwaps!, disableBatchSubs!, rotateGkAtHalftime!, currentElapsedSeconds!, currentHalf!, miniLeagueTeams, preferredSecondHalfGkId, effectiveMaxSpreadMinutes, planningOverrides)
      : createSubPlan(rs, teamSize, halfDurationSeconds, speed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, currentElapsedSeconds, currentHalf, preferredSecondHalfGkId, effectiveMaxSpreadMinutes, planningOverrides);

    let working = roster;
    if (playerPriority && playerPriority.length >= 2) {
      const rank = new Map(playerPriority.map((id, index) => [id, index] as const));
      const isSwappableOutfielder = (p: Player) =>
        p.currentPitchPosition !== "GK" && !(p.assignedPositions?.length === 1 && p.assignedPositions[0] === "GK");
      const outfieldStarterCount = working.filter(p => p.position !== null && isSwappableOutfielder(p)).length;
      const desiredStarters = new Set(
        playerPriority
          .filter(id => working.some(p => p.id === id && isSwappableOutfielder(p)))
          .slice(0, outfieldStarterCount)
      );

      for (const desiredId of desiredStarters) {
        const desired = working.find(p => p.id === desiredId);
        if (!desired || desired.position !== null) continue;
        const replacement = working
          .filter(p => p.position !== null && isSwappableOutfielder(p) && !desiredStarters.has(p.id))
          .sort((a, b) => (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER))[0];
        if (replacement) working = swapLineupPositions(working, desiredId, replacement.id);
      }
    }

    return { plan: make(working), roster: working };
  };

  const generatePlan = (allPlayers: Player[]) => {
    return buildPlanFromRoster(allPlayers, effectiveRotationSpeed);
  };
  
  // Auto-generate plan on mount AND whenever planner inputs change.
  // Without this, changing Subs Speed / Max Spread / etc. in the settings
  // dialog leaves the previously generated plan stale (e.g. Frequent still
  // showed Balanced's 38 subs because the plan was only generated once).
  useEffect(() => {
    if (editMode) return;
    const playersOnP = players.filter(p => p.position !== null);
    const benchP = players.filter(p => p.position === null);
    const hasEnough = miniLeagueTeams
      ? playersOnP.length > 0 && benchP.length > 0
      : playersOnP.length >= teamSize && benchP.length > 0;
    if (!hasEnough) {
      setIsGenerating(false);
      return;
    }
    setIsGenerating(true);
    const t = setTimeout(() => {
      try {
        // Always probe Frequent so we know whether it's a viable choice for
        // the current squad/match length, regardless of which mode is
        // currently selected. If it would strand an outfield player at 0
        // minutes we lock the toggle to Standard.
        const frequentProbe = miniLeagueTeams
          ? createMiniLeagueSubPlan(players, teamSize, minutesPerHalf * 60, 2, disablePositionSwaps!, disableBatchSubs!, rotateGkAtHalftime!, currentElapsedSeconds!, currentHalf!, miniLeagueTeams, preferredSecondHalfGkId, effectiveMaxSpreadMinutes, effectiveOverrides)
          : createSubPlan(players, teamSize, minutesPerHalf * 60, 2, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, currentElapsedSeconds, currentHalf, preferredSecondHalfGkId, effectiveMaxSpreadMinutes, effectiveOverrides);
        const probeFc = calculateTimeForecasts(players, frequentProbe, minutesPerHalf, preferredSecondHalfGkId, rotateGkAtHalftime, currentHalf, currentElapsedSeconds);
        const probeStranded = probeFc.filter(f => f.gkRole !== 'full' && f.predictedMinutes === 0);
        const frequentNotViable = probeStranded.length > 0;
        setFrequentBlocked(frequentNotViable);

        if (frequentNotViable && effectiveRotationSpeed === 2) {
          setRotationSpeedOverride(1);
          setFrequentFallbackNotice(`Frequent rotation isn't possible with this squad and match length — every player would need a turn but the rotation can't fit them all. Standard rotation is being used instead.`);
          const { plan: standardPlan, roster: standardRoster } = buildPlanFromRoster(players, 1);
          setEffectivePlayers(standardRoster);
          setPlan(standardPlan);
        } else {
          if (!frequentNotViable) setFrequentFallbackNotice(null);
          const { plan: nextPlan, roster: nextRoster } = generatePlan(players);
          setEffectivePlayers(nextRoster);
          setPlan(nextPlan);
        }
      } catch (error) {
        console.error("Error auto-generating plan:", error);
        setPlan([]);
      } finally {
        setIsGenerating(false);
      }
    }, 10);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveRotationSpeed,
    effectiveMaxSpreadMinutes,
    minutesPerHalf,
    disablePositionSwaps,
    disableBatchSubs,
    rotateGkAtHalftime,
    teamSize,
    preferredSecondHalfGkId,
    // Regenerate when the live roster / on-pitch assignments change so that
    // swapping the GK (or any starter) before opening the planner refreshes
    // the "GK 1H / GK 2H" badges and minute forecasts. We key on a compact
    // signature to avoid loops from referential identity changes.
    players.map(p => `${p.id}:${p.currentPitchPosition ?? ''}:${p.position ? '1' : '0'}`).join('|'),
    // Regenerate when advanced overrides change.
    JSON.stringify(effectiveOverrides),
    // Re-run bias when the coach reorders the priority list.
    playerPriority ? playerPriority.join('|') : '',
  ]);
  
  const playersOnPitch = players.filter(p => p.position !== null);
  const benchPlayers = players.filter(p => p.position === null);
  const hasEnoughPlayers = miniLeagueTeams
    ? playersOnPitch.length > 0 && benchPlayers.length > 0
    : playersOnPitch.length >= teamSize && benchPlayers.length > 0;
  
  // Calculate time forecasts when plan exists
  const forecasts = useMemo(() => {
    if (!plan) return [];
    return calculateTimeForecasts(effectivePlayers, plan, minutesPerHalf, preferredSecondHalfGkId, rotateGkAtHalftime, currentHalf, currentElapsedSeconds);
  }, [plan, effectivePlayers, minutesPerHalf, preferredSecondHalfGkId, rotateGkAtHalftime, currentHalf, currentElapsedSeconds]);

  // Reset stale fairness report whenever the plan changes (regen, edits, etc.)
  useEffect(() => { setFairnessReport(null); }, [plan]);

  const handleRunSimulator = () => {
    if (!plan) return;
    setIsSimulating(true);
    setTimeout(() => {
      try {
        const report = calculateFairnessReport(players, plan, minutesPerHalf);
        setFairnessReport(report);
      } catch (err) {
        console.error("[AutoSubPlan] Fairness sim error:", err);
      } finally {
        setIsSimulating(false);
      }
    }, 10);
  };
  
  const handleGenerate = () => {
    setIsGenerating(true);
    console.log("[AutoSubPlan] Generating with rotationSpeed:", rotationSpeed, "minutesPerHalf:", minutesPerHalf, "disableBatchSubs:", disableBatchSubs);
    // Use setTimeout to allow UI to update before heavy computation
    setTimeout(() => {
      try {
        const { plan: generatedPlan, roster: generatedRoster } = generatePlan(players);
        console.log("[AutoSubPlan] Generated", generatedPlan.length, "subs", miniLeagueTeams ? "(mini-league per-team)" : "");
        setEffectivePlayers(generatedRoster);
        setPlan(generatedPlan);
      } catch (error) {
        console.error("Error generating plan:", error);
        setPlan([]);
      } finally {
        setIsGenerating(false);
      }
    }, 10);
  };
  
  const handleStart = () => {
    if (plan && plan.length > 0) {
      // If priority bias swapped any starter↔bench positions, push the new
      // lineup back to the parent so the pitch matches the plan that's
      // about to run.
      if (onLineupChange) {
        const lineupChanged = effectivePlayers.some(ep => {
          const orig = players.find(p => p.id === ep.id);
          return !orig || orig.position !== ep.position;
        });
        if (lineupChanged) onLineupChange(effectivePlayers);
      }
      onStartPlan(plan);
      onClose();
    }
  };
  
  const squadSize = players.length;
  const squadEqualsOnField = !miniLeagueTeams && squadSize === teamSize && playersOnPitch.length === teamSize;
  const squadBelowOnField = !miniLeagueTeams && squadSize < teamSize;

  if (squadBelowOnField) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <AlertTriangle className="h-12 w-12 text-red-500" />
        <p className="text-center text-foreground font-medium">
          Not enough players to start a {teamSize}-a-side game.
        </p>
        <p className="text-center text-sm text-muted-foreground">
          You have {squadSize} player{squadSize === 1 ? '' : 's'} available — at least {teamSize} are required on the pitch.
        </p>
        <Button onClick={onClose} className="gap-2 mt-2">Go back</Button>
      </div>
    );
  }

  if (squadEqualsOnField) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Clock className="h-12 w-12 text-primary" />
        <p className="text-center text-foreground font-medium">No substitutions needed.</p>
        <p className="text-center text-sm text-muted-foreground">
          Your squad of {squadSize} matches the {teamSize} players on the pitch — every player is on for the full match.
        </p>
        <Button onClick={onClose} className="gap-2 mt-2">
          <Play className="h-4 w-4" />
          Continue to Pitch Board
        </Button>
      </div>
    );
  }

   if (!hasEnoughPlayers) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <p className="text-center text-muted-foreground">
          {benchPlayers.length === 0 
            ? "No bench players available — auto-substitutions aren't needed."
            : `You need ${teamSize} players on pitch and at least 1 on the bench to generate a substitution plan.`
          }
        </p>
        <p className="text-sm text-muted-foreground">
          Current: {playersOnPitch.length} on pitch, {benchPlayers.length} on bench
        </p>
        <Button onClick={onClose} className="gap-2 mt-2">
          <Play className="h-4 w-4" />
          {benchPlayers.length === 0 ? "Continue to Pitch Board" : "Go Back"}
        </Button>
      </div>
    );
  }
  
  if (isGenerating && !plan) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Generating substitution plan...</p>
      </div>
    );
  }
  
  if (plan === null) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Clock className="h-12 w-12 text-primary" />
        <p className="text-center text-muted-foreground">
          Generate an automatic substitution plan to give all {players.length} players equal playing time.
        </p>
        <Button onClick={handleGenerate} className="gap-2">
          <Play className="h-4 w-4" />
          Generate Plan
        </Button>
        <button
          onClick={onClose}
          className="mt-2 w-full max-w-xs rounded-lg border border-border bg-muted/30 p-3 text-center transition-colors hover:bg-muted/50 active:bg-muted/70"
        >
          <span className="text-sm font-medium text-foreground">Skip</span>
          <p className="mt-1 text-xs text-muted-foreground">
            You can make substitutions and swaps manually during the game instead
          </p>
        </button>
      </div>
    );
  }
  
  return (
    <>
      <div className="space-y-4">
        {/* Edit tab removed — manual editing only via parent-driven editMode */}
        
        {activeTab === 'forecast' && (
          /* Playing Time Forecast */
          <div className="pr-1">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3">
                Predicted playing time based on {plan.length} substitution{plan.length !== 1 ? 's' : ''} over {minutesPerHalf * 2} minutes
              </p>

              {(() => {
                const autoFair = calculateFairnessReport(players, plan, minutesPerHalf);
                const halfSec = minutesPerHalf * 60;
                const guard = effectiveOverrides.halftimeGuardSeconds ?? ADV_DEFAULTS.halftimeGuardSeconds;
                const hasHalftimeClash = plan.some(ev => {
                  const distFromHt = ev.half === 1 ? halfSec - ev.time : ev.time;
                  return distFromHt < guard;
                });
                // Spread reflects exactly what the coach sees in the per-player
                // minutes list below — max minus min across every player.
                const allMinutes = forecasts.map(f => f.predictedMinutes);
                const spreadMin = allMinutes.length
                  ? Math.max(...allMinutes) - Math.min(...allMinutes)
                  : 0;
                return (
                  <>
                    <PlanStatusCard
                      totalSubs={autoFair.totalSubs}
                      spreadMin={spreadMin}
                      shortShifts={autoFair.totalShortShifts}
                      hasHalftimeClash={hasHalftimeClash}
                    />
                    <PlanModeToggles
                      activeMode={effectiveRotationSpeed}
                      onChange={setRotationSpeedOverride}
                      readOnly={!!advancedOverrides}
                      disabledModes={frequentBlocked ? [2] : []}
                    />
                    {frequentFallbackNotice && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{frequentFallbackNotice}</span>
                      </div>
                    )}
                    {(() => {
                      if (!rotateGkAtHalftime || !preferredSecondHalfGkId) return null;
                      if (minutesPerHalf * 60 <= 12 * 60) return null;
                      const gk2H = players.find(p => p.id === preferredSecondHalfGkId);
                      if (!gk2H || gk2H.position) return null;
                      return (
                        <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-400">
                          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>
                            <strong>{gk2H.name}</strong> starts on the bench and is set as 2H GK — extra subs are added so they get outfield minutes in the 1st half. This can widen the minutes spread. Pick a starter as 2H GK for a tighter plan.
                          </span>
                        </div>
                      );
                    })()}
                  </>
                );
              })()}

              {/* Sub timeline preview — read-only chronological list of every planned swap */}
              {plan.length > 0 && (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setShowTimelinePreview((v) => !v)}
                    className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground rounded-md border border-border bg-muted/20 px-3 py-2"
                  >
                    <span>{showTimelinePreview ? "Hide sub timeline" : "Show sub timeline"} ({plan.length})</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showTimelinePreview ? "rotate-180" : "")} />
                  </button>
                  {showTimelinePreview && (
                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className="divide-y divide-border">
                        {[1, 2].map((half) => {
                          const halfSubs = plan.filter((s) => s.half === half);
                          if (halfSubs.length === 0) return null;
                          const groups: { time: number; items: typeof halfSubs }[] = [];
                          halfSubs.forEach((sub) => {
                            const existing = groups.find((g) => g.time === sub.time);
                            if (existing) existing.items.push(sub);
                            else groups.push({ time: sub.time, items: [sub] });
                          });
                          groups.sort((a, b) => a.time - b.time);
                          return (
                            <div key={half}>
                              <div className="px-3 py-1.5 bg-muted/50 text-xs font-semibold text-muted-foreground">
                                {half === 1 ? "1st Half" : "2nd Half"}
                              </div>
                              {groups.map((group) => {
                                const mins = Math.floor(group.time / 60);
                                const secs = group.time % 60;
                                const timeLabel = group.time === 0 && half === 2
                                  ? "HT"
                                  : `${mins}:${secs.toString().padStart(2, "0")}`;
                                return (
                                  <div key={`${half}-${group.time}`} className="flex gap-2.5 px-3 py-2">
                                    <div className="flex flex-col items-center pt-0.5 shrink-0 w-14">
                                      <Badge className="font-mono text-xs h-5 border-transparent bg-foreground/15 text-foreground hover:bg-foreground/20">
                                        {timeLabel}
                                      </Badge>
                                    </div>
                                    <div className="flex-1 space-y-1 min-w-0">
                                      {group.items.map((sub, i) => (
                                        <div key={i} className="flex items-center gap-1 text-sm">
                                          <span className="truncate text-destructive">{sub.playerOut.name}</span>
                                          <span className="text-muted-foreground text-xs">→</span>
                                          <span className="truncate text-green-600 dark:text-green-400">{sub.playerIn.name}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}


              <button
                type="button"
                onClick={() => setShowAllMinutes((v) => !v)}
                className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground rounded-md border border-border bg-muted/20 px-3 py-2"
              >
                <span>{showAllMinutes ? "Hide all player minutes" : "Show all player minutes"}</span>
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAllMinutes ? "rotate-180" : "")} />
              </button>
              {showAllMinutes && (() => {
                // Outfielders are draggable; full-game GKs are pinned at the
                // bottom and non-draggable so the bias pass never tries to
                // touch them.
                const outfield = forecasts.filter(f => f.gkRole !== 'full');
                const fullGks = forecasts.filter(f => f.gkRole === 'full');
                const priority = playerPriority ?? [];
                const orderedOutfield = [...outfield].sort((a, b) => {
                  const ai = priority.indexOf(a.player.id);
                  const bi = priority.indexOf(b.player.id);
                  if (ai === -1 && bi === -1) {
                    // Default: most predicted minutes first (mirrors the
                    // implicit "current top of list" so first drag is intuitive).
                    return b.predictedMinutes - a.predictedMinutes;
                  }
                  if (ai === -1) return 1;
                  if (bi === -1) return -1;
                  return ai - bi;
                });
                const sortableIds = orderedOutfield.map(f => f.player.id);

                const handleDragEnd = (e: DragEndEvent) => {
                  const { active, over } = e;
                  if (!over || active.id === over.id) return;
                  const oldIndex = sortableIds.indexOf(String(active.id));
                  const newIndex = sortableIds.indexOf(String(over.id));
                  if (oldIndex < 0 || newIndex < 0) return;
                  const next = arrayMove(sortableIds, oldIndex, newIndex);
                  setPlayerPriority(next);
                };

                return (
                  <>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                      <span className="flex items-center gap-1.5">
                        <GripVertical className="h-3 w-3" />
                        Drag to prioritise — top players get nudged more minutes.
                        {isGenerating && (
                          <span className="ml-1 inline-flex items-center gap-1 text-primary">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Updating…
                          </span>
                        )}
                      </span>
                      {playerPriority && playerPriority.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPlayerPriority(null)}
                          className="text-primary hover:underline"
                        >
                          Reset priority
                        </button>
                      )}
                    </div>
                    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                        <div className="space-y-1.5">
                          {orderedOutfield.map(forecast => (
                            <SortablePlayerMinutesRow
                              key={forecast.player.id}
                              forecast={forecast}
                              fairnessReport={fairnessReport}
                              draggable
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                    {fullGks.length > 0 && (
                      <div className="space-y-1.5 mt-1.5">
                        {fullGks.map(forecast => (
                          <SortablePlayerMinutesRow
                            key={forecast.player.id}
                            forecast={forecast}
                            fairnessReport={fairnessReport}
                            draggable={false}
                          />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}

            </div>
          </div>
        )}

        {activeTab === 'edit' && (
          /* Manual Edit Mode */
          <SubPlanEditor
            plan={plan}
            players={players}
            minutesPerHalf={minutesPerHalf}
            teamSize={teamSize}
            onPlanChange={setPlan}
          />
        )}
      </div>

      {/* Advanced settings — power-user thresholds for auto-sub planning. */}
      <AdvancedSettingsPanel
        open={advancedOpen}
        onToggle={() => setAdvancedOpen(o => !o)}
        overrides={effectiveOverrides}
        readOnly={!!advancedOverrides}
        onChange={persistLocal}
        defaultMaxSpreadMinutes={maxSpreadMinutes}
      />

      <div className="flex gap-2 justify-end mt-4">
        <Button variant="outline" onClick={onClose}>
          {isSetupFlow ? "Skip — do subs manually" : "Cancel"}
        </Button>
        <Button onClick={handleStart} className="gap-2" disabled={plan.length === 0}>
          <Play className="h-4 w-4" />
          Start Plan
        </Button>
      </div>
    </>
  );
}

export default function AutoSubPlanDialog({
  open,
  onOpenChange,
  players,
  teamSize,
  minutesPerHalf,
  onStartPlan,
  existingPlan,
  editMode,
  rotationSpeed = 2,
  disablePositionSwaps = false,
  disableBatchSubs = false,
  rotateGkAtHalftime = true,
  maxSpreadMinutes = 5,
  currentElapsedSeconds = 0,
  currentHalf = 1,
  preferredSecondHalfGkId,
  showStepper = false,
  onBackToLineup,
  miniLeagueTeams,
  advancedOverrides,
  onLineupChange,
}: AutoSubPlanDialogProps) {
  const handleClose = () => onOpenChange(false);
  
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay 
          className={cn(
            "fixed inset-0 z-[99998] bg-black/80",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 z-[99999] flex flex-col",
            "bg-background duration-200 overflow-hidden pt-[env(safe-area-inset-top)] landscape:pt-1",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-4 p-4 border-b border-border">
            <DialogPrimitive.Title className="min-w-0 flex-1 text-base sm:text-lg font-semibold leading-tight tracking-tight flex items-center gap-2">
              <Clock className="h-5 w-5 shrink-0" />
              <span className="min-w-0 truncate">
                {editMode ? "Edit Substitution Plan" : "Auto Substitution Plan"}
              </span>
            </DialogPrimitive.Title>
            <div className="flex items-center gap-3 shrink-0">
              {!editMode && showStepper && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {onBackToLineup ? (
                    <button
                      type="button"
                      onClick={onBackToLineup}
                      className="flex items-center gap-1.5 rounded-md px-1 py-0.5 -mx-1 hover:bg-muted/60 transition-colors"
                      aria-label="Go back to lineup"
                    >
                      <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                      <span className="underline-offset-2 hover:underline">Lineup</span>
                    </button>
                  ) : (
                    <>
                      <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                      <span>Lineup</span>
                    </>
                  )}
                  <span className="text-muted-foreground/50 mx-0.5">→</span>
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">2</span>
                  <span className="font-medium text-foreground">Subs</span>
                </div>
              )}
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto p-4">
            {open && (
              <DialogInner
                players={players}
                teamSize={teamSize}
                minutesPerHalf={minutesPerHalf}
                onStartPlan={onStartPlan}
                onClose={handleClose}
                existingPlan={existingPlan}
                editMode={editMode}
                rotationSpeed={rotationSpeed}
                disablePositionSwaps={disablePositionSwaps}
                disableBatchSubs={disableBatchSubs}
                rotateGkAtHalftime={rotateGkAtHalftime}
                maxSpreadMinutes={maxSpreadMinutes}
                currentElapsedSeconds={currentElapsedSeconds}
                currentHalf={currentHalf}
                preferredSecondHalfGkId={preferredSecondHalfGkId}
                isSetupFlow={showStepper}
                miniLeagueTeams={miniLeagueTeams}
                advancedOverrides={advancedOverrides}
                onLineupChange={onLineupChange}
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
