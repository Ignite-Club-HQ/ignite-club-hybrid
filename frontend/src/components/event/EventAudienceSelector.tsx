/**
 * Single control that replaces the old "Team" dropdown + "Target audience"
 * picker pair. Those two controls expressed overlapping state (all-club vs one
 * team vs several teams) which was confusing.
 *
 * State mapping stays exactly the same as before, so backend validation and
 * `events.target_team_ids` semantics are untouched:
 *   - Whole club     → teamId = "",   targetTeamIds = null, competitionId = ""
 *   - One team       → teamId = <id>, targetTeamIds = null
 *   - Selected teams → teamId = "",   targetTeamIds = string[] (≥ 2 to submit)
 *   - Competition    → teamId = "",   targetTeamIds = null, competitionId = <id>
 */
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import { cn } from "@/lib/utils";

interface TeamOption {
  id: string;
  name: string;
}

interface Props {
  /** Teams selectable as the single owning team. */
  teams: TeamOption[] | undefined;
  /** All teams in the club — used for the multi-select checklist. */
  clubTeams?: TeamOption[] | undefined;
  teamId: string;
  onTeamIdChange: (next: string) => void;
  targetTeamIds: string[] | null;
  onTargetTeamIdsChange: (next: string[] | null) => void;
  /** Whether this event type can be club-wide at all. */
  supportsClubWideScope: boolean;
  disabled?: boolean;
  /** Which mode is selected when there is no explicit team/target-team state. */
  defaultMode?: Mode;
  /** Pass to enable the Competition option (only when the user may organise one). */
  competitions?: TeamOption[];
  competitionId?: string;
  onCompetitionIdChange?: (next: string) => void;
  competitionTeamCount?: number;
}

type Mode = "club" | "team" | "selected" | "competition";

export function EventAudienceSelector({
  teams,
  clubTeams,
  teamId,
  onTeamIdChange,
  targetTeamIds,
  onTargetTeamIdsChange,
  supportsClubWideScope,
  disabled,
  defaultMode = "team",
  competitions,
  competitionId = "",
  onCompetitionIdChange,
  competitionTeamCount,
}: Props) {
  const showCompetition = !!onCompetitionIdChange && (competitions?.length ?? 0) > 0;
  // Derived mode is only a *hint*: picking "One team" before a team is chosen
  // leaves teamId empty, so the mode has to be remembered locally too.
  const derivedMode: Mode = competitionId
    ? "competition"
    : teamId
      ? "team"
      : Array.isArray(targetTeamIds)
        ? "selected"
        : "club";
  const [mode, setMode] = useState<Mode>(defaultMode !== "club" ? defaultMode : derivedMode);

  // Follow external changes (e.g. loading an existing event) without fighting
  // the user's in-progress choice. Once a team is chosen the derived mode wins.
  useEffect(() => {
    if (derivedMode !== "club") setMode(derivedMode);
  }, [derivedMode]);

  const checklistTeams = clubTeams ?? teams;
  const selected: string[] = Array.isArray(targetTeamIds) ? targetTeamIds : [];

  const pickMode = (next: Mode) => {
    setMode(next);
    if (next !== "competition") onCompetitionIdChange?.("");
    if (next === "club" || next === "competition") {
      onTeamIdChange("");
      onTargetTeamIdsChange(null);
    } else if (next === "team") {
      onTargetTeamIdsChange(null);
    } else {
      onTeamIdChange("");
      onTargetTeamIdsChange(selected);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onTargetTeamIdsChange(Array.from(next));
  };

  // Event types that can't be club-wide keep the plain single-team dropdown.
  if (!supportsClubWideScope) {
    return (
      <MobileCardSelect
        value={teamId}
        onValueChange={onTeamIdChange}
        options={teams?.map((t) => ({ value: t.id, label: t.name })) || []}
        placeholder="Select team"
        label="Team"
        disabled={disabled}
      />
    );
  }

  const options: Array<{ key: Mode; title: string; hint: string }> = [
    { key: "club", title: "Whole club", hint: "Everyone in the club can RSVP" },
    { key: "team", title: "One team", hint: "Pick a single team" },
    { key: "selected", title: "Several teams", hint: "Pick 2 or more teams" },
    ...(showCompetition
      ? [{ key: "competition" as Mode, title: "Competition", hint: "Teams in a competition" }]
      : []),
  ];

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Who's this for?</Label>
      <div className={cn("grid gap-2", showCompetition ? "grid-cols-2" : "grid-cols-3")}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            disabled={disabled}
            onClick={() => pickMode(o.key)}
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition-colors",
              mode === o.key
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted/40",
            )}
          >
            <div className="text-sm font-medium">{o.title}</div>
            <div className="text-[11px] leading-snug text-muted-foreground">{o.hint}</div>
          </button>
        ))}
      </div>

      {mode === "team" && (
        <MobileCardSelect
          value={teamId}
          onValueChange={onTeamIdChange}
          options={teams?.map((t) => ({ value: t.id, label: t.name })) || []}
          placeholder="Select team"
          label="Team"
          disabled={disabled}
        />
      )}

      {mode === "selected" && (
        <div className="rounded-lg border p-3 space-y-2">
          {(!checklistTeams || checklistTeams.length === 0) ? (
            <p className="text-xs text-muted-foreground">No teams available in this club.</p>
          ) : (
            checklistTeams.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={selected.includes(t.id)}
                  onCheckedChange={() => toggle(t.id)}
                  disabled={disabled}
                />
                <span>{t.name}</span>
              </label>
            ))
          )}
          {selected.length < 2 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Select at least 2 teams — for a single team, choose "One team" above.
            </p>
          )}
        </div>
      )}

      {mode === "competition" && showCompetition && (
        <div className="space-y-1.5">
          <MobileCardSelect
            value={competitionId}
            onValueChange={(v) => onCompetitionIdChange!(v)}
            options={competitions!.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select competition"
            label="Competition"
            disabled={disabled}
          />
          {competitionId && (
            <p className="text-xs text-muted-foreground">
              One event for the whole competition. Everyone on the {competitionTeamCount ?? 0} entered{" "}
              {competitionTeamCount === 1 ? "team" : "teams"} (and parents/guardians) is invited.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
