import { Button } from "@/components/ui/button";
import { Sparkles, Zap, Loader2, ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FairnessReport } from "./planner/analysis";

// ===========================================================================
// Fairness Simulator Panel
// One-click "run the plan and grade it" surfaced inside the Forecast tab.
// Renders nothing scary by default — just a CTA. Once the coach taps Run,
// shows spread + grade + short shifts + bounce-backs and unlocks per-player
// flag badges in the list below.
// ===========================================================================
export function FairnessSimulatorPanel({
  report,
  isSimulating,
  onRun,
  modeLabel,
  teamSize,
  benchSize,
}: {
  report: FairnessReport | null;
  isSimulating: boolean;
  onRun: () => void;
  modeLabel: string;
  teamSize: number;
  benchSize: number;
}) {
  const fmtMinClock = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}'${s.toString().padStart(2, "0")}`;
  };

  const gradeMeta: Record<FairnessReport["grade"], { label: string; tone: string; Icon: typeof ShieldCheck }> = {
    excellent: { label: "Excellent",  tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", Icon: ShieldCheck },
    good:      { label: "Good",       tone: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",  Icon: ShieldCheck },
    fair:      { label: "Fair",       tone: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",         Icon: ShieldAlert },
    poor:      { label: "Needs work", tone: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",                  Icon: ShieldAlert },
  };

  if (!report) {
    return (
      <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Fairness simulator
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {modeLabel} · {teamSize}v{teamSize} +{benchSize} — preview spread &amp; short shifts before saving.
          </p>
        </div>
        <Button
          size="sm"
          variant="default"
          className="gap-1.5 shrink-0"
          onClick={onRun}
          disabled={isSimulating}
        >
          {isSimulating
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Zap className="h-3.5 w-3.5" />}
          {isSimulating ? "Running…" : "Run simulator"}
        </Button>
      </div>
    );
  }

  const meta = gradeMeta[report.grade];
  const GradeIcon = meta.Icon;

  return (
    <div className={cn("mb-3 rounded-lg border p-3 space-y-3", meta.tone.split(" ").filter(c => c.startsWith("border-") || c.startsWith("bg-")).join(" "))}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <GradeIcon className={cn("h-4 w-4 shrink-0", meta.tone)} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Fairness: <span className={meta.tone.split(" ").filter(c => c.startsWith("text-")).join(" ")}>{meta.label}</span></span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {modeLabel} · {teamSize}v{teamSize} +{benchSize} · {report.totalSubs} subs
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 h-7 text-xs shrink-0"
          onClick={onRun}
          disabled={isSimulating}
        >
          {isSimulating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Re-run
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Spread</div>
          <div className="text-sm font-bold text-foreground tabular-nums">{fmtMinClock(report.spreadSeconds)}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">{fmtMinClock(report.minSeconds)} → {fmtMinClock(report.maxSeconds)}</div>
        </div>
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Short shifts</div>
          <div className={cn(
            "text-sm font-bold tabular-nums",
            report.totalShortShifts === 0 ? "text-foreground" : "text-red-500"
          )}>{report.totalShortShifts}</div>
          <div className="text-[10px] text-muted-foreground">&lt; 3 min on pitch</div>
        </div>
        <div className="rounded-md bg-background/60 border border-border p-2 text-center">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Bounce-backs</div>
          <div className={cn(
            "text-sm font-bold tabular-nums",
            report.totalBounceBacks === 0 ? "text-foreground" : "text-purple-500"
          )}>{report.totalBounceBacks}</div>
          <div className="text-[10px] text-muted-foreground">&lt; 3 min off pitch</div>
        </div>
      </div>

      {(report.totalShortShifts > 0 || report.totalBounceBacks > 0 || report.grade === "poor" || report.grade === "fair") && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          {report.grade === "poor"
            ? "This plan has noticeable imbalance. Try a different mode, increase Max Spread, or tweak Advanced settings below."
            : report.grade === "fair"
              ? "Acceptable, but a couple of players will feel it. Check the flagged rows below."
              : "Plan is solid overall — flagged rows below show edge cases worth a glance."}
        </p>
      )}
    </div>
  );
}
