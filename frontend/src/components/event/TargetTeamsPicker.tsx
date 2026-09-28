/**
 * Multi-team picker for club-wide games/socials that should only be seen
 * by members of a subset of teams (see `events.target_team_ids`).
 *
 * Mode semantics (locked, mirrored by backend validation trigger):
 *   - value === null           → "All club members" mode.
 *   - Array.isArray(value)     → "Only selected teams" editing mode.
 *     Any array — including [] — keeps the picker OPEN. Submission of the
 *     surrounding form is only allowed when the array contains ≥ 2 distinct
 *     team ids; the "select at least 2 teams" warning stays visible until
 *     that condition is met.
 *
 * IMPORTANT: never use `value.length` as the mode discriminator. Doing so
 * makes it impossible for a user to enter selected-team mode from null,
 * because the first click would call onChange([]) and immediately snap
 * back to all-club mode.
 */
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface TeamOption {
  id: string;
  name: string;
}

interface Props {
  teams: TeamOption[] | undefined;
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
}

export function TargetTeamsPicker({ teams, value, onChange, disabled }: Props) {
  // Selected-team mode iff caller has committed to an array (even empty).
  const active = Array.isArray(value);

  const selected: string[] = active ? value! : [];

  const toggle = (id: string) => {
    // Immutable dedupe via Set — never mutate the caller's array, never
    // emit duplicate ids, and never collapse back to null when the last
    // team is removed (stay in editing mode with the warning shown).
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Target audience</Label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm text-left transition-colors",
            !active
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/40",
          )}
        >
          <div className="font-medium">All club members</div>
          <div className="text-xs text-muted-foreground">Everyone in the club can RSVP</div>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(active ? selected : [])}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm text-left transition-colors",
            active
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/40",
          )}
        >
          <div className="font-medium">Only selected teams</div>
          <div className="text-xs text-muted-foreground">Pick 2 or more teams below</div>
        </button>
      </div>

      {active && (
        <div className="rounded-lg border p-3 space-y-2">
          {(!teams || teams.length === 0) ? (
            <p className="text-xs text-muted-foreground">No teams available in this club.</p>
          ) : (
            teams.map((t) => {
              const checked = selected.includes(t.id);
              return (
                <label
                  key={t.id}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(t.id)}
                    disabled={disabled}
                  />
                  <span>{t.name}</span>
                </label>
              );
            })
          )}
          {selected.length < 2 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Select at least 2 teams — for a single team, choose it directly in the Team dropdown.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
