import { useState, useMemo, useEffect } from "react";
import { Trophy, ChevronDown, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { TeamAvatar } from "@/components/competition/TeamAvatar";

export function LadderView({ rows, divisions, isAdmin = false }: { rows: any[]; divisions: any[]; isAdmin?: boolean }) {
  const [filterDivisionId, setFilterDivisionId] = useState<string>("_all");
  const [filterTeamId, setFilterTeamId] = useState<string>("_all");
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);

  const hiddenDivisionIds = useMemo(
    () => new Set(divisions.filter((d: any) => d.hide_ladder).map((d: any) => d.id)),
    [divisions]
  );
  const hasHiddenDivisions = hiddenDivisionIds.size > 0;

  // Admins see all rows (with a "Hidden" badge on hidden divisions).
  // If any ladder is hidden, non-admins see no ladder at all.
  const visibleRows = useMemo(
    () => isAdmin
      ? rows
      : hasHiddenDivisions ? [] : rows,
    [rows, hasHiddenDivisions, isAdmin]
  );

  const presentDivisionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of visibleRows) if (r.division_id) ids.add(r.division_id);
    return ids;
  }, [visibleRows]);

  const divisionOptions = divisions.filter((d: any) => presentDivisionIds.has(d.id));
  const showDivisionFilter = divisionOptions.length > 1;

  const teamOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of visibleRows) {
      if (filterDivisionId !== "_all" && r.division_id !== filterDivisionId) continue;
      if (r.team_id) seen.set(r.team_id, r.teams?.name ?? "?");
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visibleRows, filterDivisionId]);

  useEffect(() => {
    if (filterTeamId !== "_all" && !teamOptions.some((t) => t.id === filterTeamId)) {
      setFilterTeamId("_all");
    }
  }, [filterTeamId, teamOptions]);
  const showTeamFilter = teamOptions.length > 1;

  // When a team is selected, show every ladder group that team participates in
  // (full standings, not just the selected team's row). Competitions without
  // divisions use the "Overall" ladder, where division_id is null.
  const teamDivisionKeys = useMemo(() => {
    if (filterTeamId === "_all") return null;
    const ids = new Set<string>();
    for (const r of visibleRows) {
      if (r.team_id === filterTeamId) ids.add(r.division_id ?? "__none");
    }
    return ids;
  }, [visibleRows, filterTeamId]);

  const filteredRows = visibleRows.filter((r: any) => {
    if (filterDivisionId !== "_all" && r.division_id !== filterDivisionId) return false;
    if (teamDivisionKeys && !teamDivisionKeys.has(r.division_id ?? "__none")) return false;
    return true;
  });

  const groups = new Map<string, any[]>();
  if (divisionOptions.length <= 1) {
    // Only one division — collapse Overall rows into the divisional ladder by team_id
    const overallRows = filteredRows.filter((r: any) => !r.division_id);
    const divRows = filteredRows.filter((r: any) => r.division_id);
    if (divRows.length) {
      const overallByTeam = new Map(overallRows.map((r: any) => [r.team_id, r]));
      const merged = divRows.map((r: any) => {
        const o = overallByTeam.get(r.team_id);
        if (!o) return r;
        // Prefer the row with actual played matches
        const hasDivData = (r.played ?? 0) > 0;
        const hasOverallData = (o.played ?? 0) > 0;
        if (hasOverallData && !hasDivData) {
          return { ...o, division_id: r.division_id, teams: r.teams ?? o.teams };
        }
        return r;
      });
      // Re-sort by points / goal_diff / goals_for
      merged.sort((a: any, b: any) =>
        (b.points ?? 0) - (a.points ?? 0) ||
        (b.goal_diff ?? 0) - (a.goal_diff ?? 0) ||
        (b.goals_for ?? 0) - (a.goals_for ?? 0)
      );
      groups.set(divRows[0].division_id, merged);
    } else if (overallRows.length) {
      groups.set("__none", overallRows);
    }
  } else {
    filteredRows.forEach((r: any) => {
      const key = r.division_id ?? "__none";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    });
  }

  return (
    <div className="space-y-4">
      {(showDivisionFilter || showTeamFilter) && (
        <div className="flex flex-wrap gap-2">
          {showDivisionFilter && (
            <Select value={filterDivisionId} onValueChange={setFilterDivisionId}>
              <SelectTrigger className="h-9 w-auto min-w-[140px]">
                <SelectValue placeholder="All divisions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All divisions</SelectItem>
                {divisionOptions.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {showTeamFilter && (
            <>
              <button
                type="button"
                onClick={() => setTeamSheetOpen(true)}
                className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                {filterTeamId === "_all"
                  ? "All teams"
                  : teamOptions.find((t) => t.id === filterTeamId)?.name ?? "All teams"}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </button>
              <Sheet open={teamSheetOpen} onOpenChange={setTeamSheetOpen}>
                <SheetContent side="bottom" className="max-h-[85vh] rounded-t-xl p-0">
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
                  </div>
                  <SheetHeader className="px-4 pb-2 text-left">
                    <SheetTitle className="text-base">Filter by team</SheetTitle>
                    <SheetDescription className="sr-only">
                      Choose a team to filter the fixture list.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="max-h-[60vh] overflow-y-auto px-4 pb-6">
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setFilterTeamId("_all");
                          setTeamSheetOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                      >
                        <span>All teams</span>
                        {filterTeamId === "_all" && <Check className="h-4 w-4 text-primary" />}
                      </button>
                      {teamOptions.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setFilterTeamId(t.id);
                            setTeamSheetOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                        >
                          <span>{t.name}</span>
                          {filterTeamId === t.id && <Check className="h-4 w-4 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
        </div>
      )}

      {groups.size === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No standings match the current filter.
          </CardContent>
        </Card>
      ) : (
        <TooltipProvider delayDuration={150}>
          {Array.from(groups.entries()).map(([divId, list]) => {
            const div = divisions.find((d: any) => d.id === divId);
            return (
              <LadderDivisionCard
                key={divId}
                title={div?.name ?? "Overall"}
                rows={list}
                isHidden={isAdmin && !!div?.hide_ladder}
              />
            );
          })}
        </TooltipProvider>
      )}
    </div>
  );
}

const COL_TOOLTIPS: Record<string, string> = {
  P: "Played",
  W: "Wins",
  D: "Draws",
  L: "Losses",
  "+/-": "Goal difference (for − against)",
  Pts: "Competition points",
};

function ColHead({ label, className }: { label: string; className?: string }) {
  return (
    <th className={cn("py-2 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{label}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{COL_TOOLTIPS[label]}</TooltipContent>
      </Tooltip>
    </th>
  );
}

function LadderDivisionCard({ title, rows, isHidden = false }: { title: string; rows: any[]; isHidden?: boolean }) {
  const [open, setOpen] = useState(true);
  const teamCount = rows.length;
  const seasonStarted = rows.some((r) => (r.played ?? 0) > 0);

  return (
    <Card className="overflow-hidden">
      {/* Compact division header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-primary/5 border-b border-border/60 text-left hover:bg-primary/10 transition-colors"
        aria-expanded={open}
      >
        <Trophy className="h-3.5 w-3.5 text-primary shrink-0" />
        <div className="text-sm font-semibold text-foreground truncate">{title}</div>
        {isHidden && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shrink-0">
            Hidden
          </span>
        )}
        <span className="text-[11px] text-muted-foreground shrink-0">
          · {teamCount} {teamCount === 1 ? "team" : "teams"}
          {!seasonStarted && " · Not started"}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform ml-auto", !open && "-rotate-90")} />
      </button>


      {open && (
        <div>
          {!seasonStarted ? (
            <div className="px-4 py-8 text-center space-y-2">
              <Trophy className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                No results entered yet. Rankings will appear once matches are completed.
              </p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead className="sticky top-0 bg-primary/5">
                <tr>
                  <th className="py-2 pl-3 pr-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/70 text-left w-9">#</th>
                  <th className="py-2 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70 text-left">Team</th>
                  <ColHead label="P" className="text-right" />
                  <ColHead label="W" className="text-right" />
                  <ColHead label="D" className="text-right" />
                  <ColHead label="L" className="text-right" />
                  <ColHead label="+/-" className="text-right pl-3" />
                  <ColHead label="Pts" className="text-right pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => {
                  const rank = i + 1;
                  const gd = r.goal_diff ?? 0;
                  const medalColor =
                    rank === 1
                      ? "bg-amber-400/25 text-amber-700 dark:text-amber-300 ring-1 ring-amber-400/50"
                      : rank === 2
                      ? "bg-slate-400/25 text-slate-700 dark:text-slate-300 ring-1 ring-slate-400/50"
                      : rank === 3
                      ? "bg-orange-500/25 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/50"
                      : "bg-muted text-muted-foreground";
                  const topTint =
                    rank === 1 ? "bg-amber-400/[0.06]"
                    : rank === 2 ? "bg-slate-400/[0.06]"
                    : rank === 3 ? "bg-orange-500/[0.06]"
                    : i % 2 === 1 ? "bg-muted/20" : "";
                  const teamName = r.teams?.name ?? "?";
                  const initials = teamName
                    .split(/\s+/)
                    .map((s: string) => s[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  const RowContent = (
                    <>
                      <td className={cn("py-3 pl-3 pr-1 align-middle", topTint)}>
                        <span
                          className={cn(
                            "inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                            medalColor,
                          )}
                        >
                          {rank}
                        </span>
                      </td>
                      <td className={cn("py-3 px-1.5 align-middle min-w-0", topTint)}>
                        <div className="flex items-center gap-2 min-w-0">
                          <TeamAvatar name={teamName} logoUrl={r.teams?.logo_url} initials={initials} size={28} />
                          <span className="font-semibold text-foreground truncate">{teamName}</span>
                        </div>
                      </td>
                      <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{r.played ?? 0}</td>
                      <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{r.wins ?? 0}</td>
                      <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{r.draws ?? 0}</td>
                      <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{r.losses ?? 0}</td>
                      <td
                        className={cn(
                          "py-3 px-1.5 pl-3 text-right tabular-nums font-medium",
                          gd > 0 && "text-emerald-600 dark:text-emerald-400",
                          gd < 0 && "text-rose-600 dark:text-rose-400",
                          gd === 0 && "text-muted-foreground",
                          topTint,
                        )}
                      >
                        {gd > 0 ? `+${gd}` : gd}
                      </td>
                      <td className={cn("py-3 px-1.5 pr-3 text-right tabular-nums font-bold text-foreground", topTint)}>
                        {r.points ?? 0}
                      </td>
                    </>
                  );
                  return r.team_id ? (
                    <tr
                      key={r.team_id}
                      className="group cursor-pointer hover:bg-accent/40 active:bg-accent/60 transition-colors"
                      onClick={() => {
                        window.location.href = `/teams/${r.team_id}`;
                      }}
                    >
                      {RowContent}
                    </tr>
                  ) : (
                    <tr key={`row-${i}`}>{RowContent}</tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
    </Card>
  );
}




