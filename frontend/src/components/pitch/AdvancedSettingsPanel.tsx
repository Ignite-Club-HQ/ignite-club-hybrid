import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, RotateCcw, Sliders } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { ADV_DEFAULTS, type AutoSubAdvancedOverrides } from "./planner/advancedOverrides";

function fmtSec(sec: number): string {
  if (sec >= 60 && sec % 60 === 0) return `${sec / 60} min`;
  if (sec >= 60) return `${(sec / 60).toFixed(1)} min`;
  return `${sec}s`;
}

function NumberRow({
  label, hint, value, defaultValue, min, max, step, disabled, onChange,
}: {
  label: string;
  hint: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (next: number | undefined) => void;
}) {
  const isOverridden = value !== defaultValue;
  const inputId = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-xs font-medium text-foreground">{label}</label>
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-xs tabular-nums",
            isOverridden ? "text-primary font-semibold" : "text-muted-foreground"
          )}>
            {fmtSec(value)}
          </span>
          {isOverridden && !disabled && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              reset
            </button>
          )}
        </div>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary disabled:opacity-50"
      />
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

export function AdvancedSettingsPanel({
  open, onToggle, overrides, readOnly, onChange, defaultMaxSpreadMinutes,
}: {
  open: boolean;
  onToggle: () => void;
  overrides: AutoSubAdvancedOverrides;
  readOnly: boolean;
  onChange: (next: AutoSubAdvancedOverrides) => void;
  defaultMaxSpreadMinutes: number;
}) {
  const defaultMaxSpreadSec = Math.round(defaultMaxSpreadMinutes * 60);
  const v = {
    standardTargetIntervalSec: overrides.standardTargetIntervalSec ?? ADV_DEFAULTS.standardTargetIntervalSec,
    standardIntervalFloorSec: overrides.standardIntervalFloorSec ?? ADV_DEFAULTS.standardIntervalFloorSec,
    frequentIntervalFloorSec: overrides.frequentIntervalFloorSec ?? ADV_DEFAULTS.frequentIntervalFloorSec,
    minShiftSeconds: overrides.minShiftSeconds ?? ADV_DEFAULTS.minShiftSeconds,
    halftimeGuardSeconds: overrides.halftimeGuardSeconds ?? ADV_DEFAULTS.halftimeGuardSeconds,
    maxSpreadOverrideSec: overrides.maxSpreadOverrideSec ?? defaultMaxSpreadSec,
  };
  const overrideCount = (Object.keys(overrides) as (keyof AutoSubAdvancedOverrides)[])
    .filter(k => overrides[k] !== undefined).length;

  const set = (key: Exclude<keyof AutoSubAdvancedOverrides, "playerPriorityOrder">, next: number | undefined) => {
    if (readOnly) return;
    const merged: AutoSubAdvancedOverrides = { ...overrides };
    if (next === undefined) delete merged[key];
    else merged[key] = next;
    onChange(merged);
  };

  const resetAll = () => onChange({});

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sliders className="h-4 w-4" />
          Show expert controls
          {overrideCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {overrideCount} custom
            </Badge>
          )}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-4 border-t border-border">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Raw planner thresholds. Most coaches won't need these — use the suggested fixes above instead.
          </p>
          {readOnly && (
            <p className="text-[11px] text-muted-foreground italic">
              These thresholds are controlled by the parent screen and can't be changed here.
            </p>
          )}

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Balance game time
            </p>
            <NumberRow
              label="Fairer minutes vs fewer stoppages"
              hint="Lower = more substitution moments and fairer minutes. Higher = fewer interruptions but a wider playing-time spread."
              value={v.standardTargetIntervalSec}
              defaultValue={ADV_DEFAULTS.standardTargetIntervalSec}
              min={180} max={900} step={30}
              disabled={readOnly}
              onChange={(n) => set("standardTargetIntervalSec", n)}
            />
            <NumberRow
              label="Max playing-time spread"
              hint="The biggest acceptable gap between your most-played and least-played outfielder by full-time. Tighter = fairer minutes but more subs."
              value={v.maxSpreadOverrideSec}
              defaultValue={defaultMaxSpreadSec}
              min={120} max={720} step={30}
              disabled={readOnly}
              onChange={(n) => set("maxSpreadOverrideSec", n)}
            />
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Prevent awkward timing
            </p>
            <NumberRow
              label="Space out substitution moments"
              hint="Lower = more frequent substitution moments and fairer minutes. Higher = calmer match flow."
              value={v.standardIntervalFloorSec}
              defaultValue={ADV_DEFAULTS.standardIntervalFloorSec}
              min={120} max={600} step={30}
              disabled={readOnly}
              onChange={(n) => set("standardIntervalFloorSec", n)}
            />
            <NumberRow
              label="Space out substitution moments (Frequent mode)"
              hint="Applies only when Frequent mode is selected. Lower = more rotations, busier match flow."
              value={v.frequentIntervalFloorSec}
              defaultValue={ADV_DEFAULTS.frequentIntervalFloorSec}
              min={60} max={420} step={15}
              disabled={readOnly}
              onChange={(n) => set("frequentIntervalFloorSec", n)}
            />
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Player shift protection
            </p>
            <NumberRow
              label="Allow short cameos vs protect player shifts"
              hint="Lower = players can come off sooner so minutes balance faster. Higher = no cameo shifts but a wider playing-time spread."
              value={v.minShiftSeconds}
              defaultValue={ADV_DEFAULTS.minShiftSeconds}
              min={60} max={360} step={15}
              disabled={readOnly}
              onChange={(n) => set("minShiftSeconds", n)}
            />
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Halftime protection
            </p>
            <NumberRow
              label="Allow halftime subs vs keep halftime clean"
              hint="Lower = subs can land near the halftime whistle. Higher = halftime stays untouched but rotations may shift earlier or later."
              value={v.halftimeGuardSeconds}
              defaultValue={ADV_DEFAULTS.halftimeGuardSeconds}
              min={0} max={420} step={15}
              disabled={readOnly}
              onChange={(n) => set("halftimeGuardSeconds", n)}
            />
          </div>

          <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Current tuning:</span>{" "}
            subs roughly every {Math.round(v.standardTargetIntervalSec / 60)} min,
            minimum {Math.round(v.standardIntervalFloorSec / 60)} min between sub moments,
            players stay on at least {Math.round(v.minShiftSeconds / 60)} min.
          </div>

          {!readOnly && overrideCount > 0 && (
            <div className="flex justify-end pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={resetAll}
              >
                <RotateCcw className="h-3 w-3" />
                Reset all to defaults
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
