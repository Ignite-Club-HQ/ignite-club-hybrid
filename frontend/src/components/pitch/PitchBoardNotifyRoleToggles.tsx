/**
 * PitchBoardNotifyRoleToggles — per-team toggles that gate pitch-board
 * push/email notifications (pending sub, half time, full time) by role.
 *
 * Stored on `team_subscriptions` as `pitch_notify_coach`,
 * `pitch_notify_team_admin`, `pitch_notify_subs_manager`. All default to ON.
 *
 * The `check-pending-subs` edge function reads these flags and excludes
 * roles that are disabled. Mini-league pitch boards (event-group-*) are not
 * affected — they always notify the Referee/Subs Manager duty assignees.
 */
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  teamId: string;
  readOnly?: boolean;
}

type RoleKey = "coach" | "team_admin" | "subs_manager";

const COLS: Record<RoleKey, string> = {
  coach: "pitch_notify_coach",
  team_admin: "pitch_notify_team_admin",
  subs_manager: "pitch_notify_subs_manager",
};

const LABELS: Record<RoleKey, { title: string; desc: string }> = {
  coach: { title: "Notify Coaches", desc: "Push & email for team coaches" },
  team_admin: { title: "Notify Team Admins", desc: "Push & email for team admins" },
  subs_manager: { title: "Notify Subs Manager", desc: "Push & email for the match-day Subs Manager duty" },
};

export function PitchBoardNotifyRoleToggles({ teamId, readOnly }: Props) {
  // Mini-league/event-group boards don't use these team-scoped flags.
  const isMiniLeague = !teamId || teamId.startsWith("event-group-");

  const [values, setValues] = useState<Record<RoleKey, boolean>>({
    coach: true,
    team_admin: true,
    subs_manager: true,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isMiniLeague) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("team_subscriptions")
        .select("pitch_notify_coach, pitch_notify_team_admin, pitch_notify_subs_manager")
        .eq("team_id", teamId)
        .maybeSingle();
      if (cancelled) return;
      setValues({
        coach: data?.pitch_notify_coach !== false,
        team_admin: data?.pitch_notify_team_admin !== false,
        subs_manager: data?.pitch_notify_subs_manager !== false,
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId, isMiniLeague]);

  if (isMiniLeague) return null;

  const update = async (key: RoleKey, next: boolean) => {
    setValues((p) => ({ ...p, [key]: next }));
    try {
      const { error } = await supabase
        .from("team_subscriptions")
        .upsert({ team_id: teamId, [COLS[key]]: next } as never, { onConflict: "team_id" });
      if (error) throw error;
    } catch (e) {
      console.error("Failed to update pitch notify flag", e);
      // Revert on failure
      setValues((p) => ({ ...p, [key]: !next }));
    }
  };

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <div className="flex items-center gap-2 pt-1">
        <Bell className="h-3.5 w-3.5 text-muted-foreground" />
        <Label className="text-xs text-muted-foreground">Pitch Board Notifications</Label>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed -mt-1">
        Choose which roles receive pending-sub, half-time and full-time alerts. Turn all off to silence pitch board pushes for this team.
      </p>
      {(Object.keys(LABELS) as RoleKey[]).map((key) => (
        <div key={key} className="flex items-center justify-between py-1">
          <div className="flex flex-col gap-0.5 min-w-0 pr-2">
            <Label htmlFor={`notify-${key}`} className="text-sm">
              {LABELS[key].title}
            </Label>
            <span className="text-[10px] text-muted-foreground">{LABELS[key].desc}</span>
          </div>
          <Switch
            id={`notify-${key}`}
            checked={values[key]}
            disabled={readOnly || !loaded}
            onCheckedChange={(v) => update(key, v)}
          />
        </div>
      ))}
    </div>
  );
}
