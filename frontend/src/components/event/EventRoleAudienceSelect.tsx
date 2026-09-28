import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Lock } from "lucide-react";

export type ClubEventRole =
  | "committee_member"
  | "club_admin"
  | "league_admin"
  | "team_admin"
  | "coach";

const ROLE_OPTIONS: { value: ClubEventRole; label: string }[] = [
  { value: "committee_member", label: "Committee members" },
  { value: "club_admin", label: "Club admins" },
  { value: "league_admin", label: "League admins" },
  { value: "team_admin", label: "Team admins" },
  { value: "coach", label: "Coaches" },
];

interface Props {
  value: ClubEventRole[];
  onChange: (next: ClubEventRole[]) => void;
}

/**
 * Multi-select role restriction for club-wide social events.
 * When empty, the event is visible to all club members (existing behaviour).
 * When one or more roles are picked, only members holding any of those roles
 * (plus club_admin / app_admin) can see the event.
 */
export function EventRoleAudienceSelect({ value, onChange }: Props) {
  const toggle = (role: ClubEventRole, checked: boolean) => {
    if (checked) {
      if (!value.includes(role)) onChange([...value, role]);
    } else {
      onChange(value.filter((r) => r !== role));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm font-medium">Restrict to roles (optional)</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Leave all unchecked for everyone in the club. Pick one or more roles to limit who sees and is invited to this event (e.g. committee meeting).
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {ROLE_OPTIONS.map((opt) => {
          const checked = value.includes(opt.value);
          return (
            <label
              key={opt.value}
              className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-accent/40"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(c) => toggle(opt.value, !!c)}
              />
              <span className="text-sm">{opt.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
