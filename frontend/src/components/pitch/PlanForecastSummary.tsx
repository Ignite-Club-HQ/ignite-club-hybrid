import { useState } from "react";
import { ArrowRight, Check, ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADV_DEFAULTS, type AutoSubAdvancedOverrides } from "./planner/advancedOverrides";

// ===========================================================================
// PlanForecastSummary — presentation components for the forecast tab's
// plain-English plan status, "what changed" impact preview, and the
// standard/frequent rotation mode toggles. Extracted from AutoSubPlanDialog
// to keep planner state/derivation and presentation concerns separate.
// Behavior, displayed text, and classes are preserved exactly.
// ===========================================================================

export interface PlanImpactBaseline {
  totalSubs: number;
  spreadMin: number;
  shortShifts: number;
  hasHalftimeClash: boolean;
}
// ===========================================================================
// PlanStatusCard — calm, plain-English headline + 3 key chips. Replaces the
// dense "Game time fairness" grid for everyday coaches.
// ===========================================================================
export function PlanStatusCard({
  totalSubs,
  spreadMin,
  shortShifts,
  hasHalftimeClash,
}: {
  totalSubs: number;
  spreadMin: number;
  shortShifts: number;
  hasHalftimeClash: boolean;
}) {
  const hasShortShifts = shortShifts > 0;
  const hasSpread = spreadMin > 6;
  const needsAdjustment = hasHalftimeClash || hasShortShifts || hasSpread;

  const toneClasses = needsAdjustment
    ? "border-amber-500/40 bg-amber-500/5"
    : "border-emerald-500/40 bg-emerald-500/5";

  return (
    <div className={cn("rounded-lg border p-3 mb-2", toneClasses)}>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Subs</div>
          <div className="text-sm font-bold text-foreground tabular-nums">{totalSubs}</div>
        </div>
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Minutes diff</div>
          <div className={cn("text-sm font-bold tabular-nums", hasSpread ? "text-amber-600" : "text-foreground")}>
            {spreadMin.toFixed(1)}m
          </div>
        </div>
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Very short turns</div>
          <div className={cn("text-sm font-bold tabular-nums", hasShortShifts ? "text-amber-600" : "text-emerald-600")}>
            {shortShifts}
          </div>
        </div>
      </div>
    </div>
  );
}


export function PlanImpactPreview({
  overrides,
  defaultMaxSpreadMinutes,
  baseline,
  totalSubs,
  spreadMin,
  shortShifts,
  hasHalftimeClash,
}: {
  overrides: AutoSubAdvancedOverrides;
  defaultMaxSpreadMinutes: number;
  baseline: { totalSubs: number; spreadMin: number; shortShifts: number; hasHalftimeClash: boolean } | null;
  totalSubs: number;
  spreadMin: number;
  shortShifts: number;
  hasHalftimeClash: boolean;
}) {
  const overrideKeys = Object.keys(overrides) as (keyof AutoSubAdvancedOverrides)[];
  const active = overrideKeys.filter((k) => overrides[k] !== undefined);
  if (active.length === 0) return null;

  const phrases: string[] = [];
  if (overrides.standardTargetIntervalSec !== undefined) {
    phrases.push(
      overrides.standardTargetIntervalSec < ADV_DEFAULTS.standardTargetIntervalSec
        ? "give players more even minutes"
        : "reduce the number of substitutions",
    );
  }
  if (overrides.standardIntervalFloorSec !== undefined) {
    phrases.push(
      overrides.standardIntervalFloorSec > ADV_DEFAULTS.standardIntervalFloorSec
        ? "space out substitutions"
        : "allow substitutions more often",
    );
  }
  if (overrides.minShiftSeconds !== undefined) {
    phrases.push(
      overrides.minShiftSeconds > ADV_DEFAULTS.minShiftSeconds
        ? "stop very short turns on the pitch"
        : "allow shorter turns so minutes balance faster",
    );
  }
  if (overrides.halftimeGuardSeconds !== undefined) {
    phrases.push(
      overrides.halftimeGuardSeconds > ADV_DEFAULTS.halftimeGuardSeconds
        ? "keep substitutions away from halftime"
        : "allow substitutions closer to halftime",
    );
  }
  if (overrides.maxSpreadOverrideSec !== undefined) {
    const min = overrides.maxSpreadOverrideSec / 60;
    phrases.push(
      min < defaultMaxSpreadMinutes
        ? "tighten the acceptable minutes difference"
        : "loosen the acceptable minutes difference",
    );
  }

  const sentence = phrases.length
    ? `This will ${phrases.slice(0, -1).join(", ")}${phrases.length > 1 ? " and " : ""}${phrases[phrases.length - 1]}.`
    : "Custom tuning is active.";

  return (
    <PlanImpactPreviewBody
      sentence={sentence}
      baseline={baseline}
      totalSubs={totalSubs}
      spreadMin={spreadMin}
      shortShifts={shortShifts}
      hasHalftimeClash={hasHalftimeClash}
    />
  );
}


function PlanImpactPreviewBody({
  sentence,
  baseline,
  totalSubs,
  spreadMin,
  shortShifts,
  hasHalftimeClash,
}: {
  sentence: string;
  baseline: { totalSubs: number; spreadMin: number; shortShifts: number; hasHalftimeClash: boolean } | null;
  totalSubs: number;
  spreadMin: number;
  shortShifts: number;
  hasHalftimeClash: boolean;
}) {
  const [open, setOpen] = useState(true);

  const Row = ({
    label,
    before,
    after,
    improved,
  }: { label: string; before: string; after: string; improved: boolean | null }) => (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums text-foreground flex items-center justify-end gap-1.5">
        {baseline ? (
          <>
            <span className="text-muted-foreground line-through">{before}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span
              className={cn(
                "font-semibold",
                improved === true && "text-emerald-600 dark:text-emerald-400",
                improved === false && "text-amber-600 dark:text-amber-400",
              )}
            >
              {after}
            </span>
          </>
        ) : (
          <span>{after}</span>
        )}
      </span>
    </>
  );

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-sm font-semibold text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          What changed
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open ? "rotate-180" : "")} />
      </button>
      {open && (
        <>
          <p className="text-[11px] leading-snug text-foreground">{sentence}</p>
          {(() => {
            if (!baseline) return null;
            const improvedAny =
              totalSubs < baseline.totalSubs ||
              spreadMin < baseline.spreadMin ||
              shortShifts < baseline.shortShifts ||
              (baseline.hasHalftimeClash && !hasHalftimeClash);
            const worsenedAny =
              totalSubs > baseline.totalSubs ||
              spreadMin > baseline.spreadMin + 0.05 ||
              shortShifts > baseline.shortShifts ||
              (!baseline.hasHalftimeClash && hasHalftimeClash);
            // If the active priority made things worse overall, warn the
            // coach so they can switch rather than treat it as a success.
            if (worsenedAny && !improvedAny) {
              return (
                <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                  This priority made the plan worse overall. Try a different priority below.
                </p>
              );
            }
            if (worsenedAny) {
              return (
                <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                  This improved one thing but made another worse. Try a different priority if the trade-off isn't right.
                </p>
              );
            }
            return null;
          })()}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] pt-2 border-t border-primary/20">
            <Row
              label="Total substitutions"
              before={`${baseline?.totalSubs ?? totalSubs}`}
              after={`${totalSubs}`}
              improved={baseline ? totalSubs < baseline.totalSubs ? true : totalSubs > baseline.totalSubs ? false : null : null}
            />
            <Row
              label="Minutes difference"
              before={`${(baseline?.spreadMin ?? spreadMin).toFixed(1)}m`}
              after={`${spreadMin.toFixed(1)}m`}
              improved={baseline ? spreadMin < baseline.spreadMin ? true : spreadMin > baseline.spreadMin ? false : null : null}
            />
            <Row
              label="Very short turns"
              before={`${baseline?.shortShifts ?? shortShifts}`}
              after={`${shortShifts}`}
              improved={baseline ? shortShifts < baseline.shortShifts ? true : shortShifts > baseline.shortShifts ? false : null : null}
            />
            <Row
              label="Subs near halftime"
              before={baseline?.hasHalftimeClash ? "Yes" : "No"}
              after={hasHalftimeClash ? "Yes" : "No"}
              improved={baseline ? (baseline.hasHalftimeClash && !hasHalftimeClash) ? true : (!baseline.hasHalftimeClash && hasHalftimeClash) ? false : null : null}
            />
          </div>
        </>
      )}
    </div>
  );
}


// ===========================================================================
// PlanModeToggles — pick Standard or Frequent rotation cadence. Standard
// keeps subs low; Frequent rotates more often for tighter minutes spread.
// ===========================================================================
const MODE_TOGGLES: { id: 1 | 2; title: string; tradeoff: string }[] = [
  {
    id: 1,
    title: "Standard",
    tradeoff: "Fewer substitutions, longer shifts. Minutes may differ a little more between players.",
  },
  {
    id: 2,
    title: "Frequent",
    tradeoff: "More substitutions, tighter rotation. Minutes even out faster across the squad.",
  },
];

export function PlanModeToggles({
  activeMode,
  onChange,
  readOnly,
  disabledModes = [],
}: {
  activeMode: 1 | 2;
  onChange: (mode: 1 | 2) => void;
  readOnly: boolean;
  disabledModes?: (1 | 2)[];
}) {
  if (readOnly) return null;
  return (
    <div className="space-y-1.5 mb-2">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-0.5">
        Rotation mode
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {MODE_TOGGLES.map((m) => {
          const isActive = activeMode === m.id;
          const isDisabled = disabledModes.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onChange(m.id)}
              aria-disabled={isDisabled}
              title={isDisabled ? "Not available for this squad size and match length" : undefined}
              className={cn(
                "text-left rounded-md border transition-colors p-2.5 min-h-[40px]",
                isActive
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background hover:bg-muted/60",
                isDisabled && "opacity-50 cursor-not-allowed hover:bg-background",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className="block text-xs font-semibold text-foreground">{m.title}</span>
                {isActive && !isDisabled && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    <Check className="h-2.5 w-2.5" />
                    On
                  </span>
                )}
                {isDisabled && (
                  <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Unavailable
                  </span>
                )}
              </span>
              <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">
                {m.tradeoff}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
