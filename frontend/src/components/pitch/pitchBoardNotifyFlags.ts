/**
 * Shared client helper for reading per-team pitch-board notification role
 * flags from `team_subscriptions`. Used by client-side push fan-outs
 * (auto-sub pushes on netball/basketball boards, game-linked emails) so
 * they honour the same "disable by role" toggles as the server-side
 * `check-pending-subs` cron.
 *
 * Mini-league (event-group-*) boards do not use these flags and always
 * return the default (all roles enabled).
 */
import { supabase } from "@/integrations/supabase/client";

export interface PitchNotifyFlags {
  coach: boolean;
  team_admin: boolean;
  subs_manager: boolean;
}

const DEFAULT_FLAGS: PitchNotifyFlags = {
  coach: true,
  team_admin: true,
  subs_manager: true,
};

export async function loadPitchNotifyFlags(
  teamId: string | null | undefined,
): Promise<PitchNotifyFlags> {
  if (!teamId || teamId.startsWith("event-group-")) return DEFAULT_FLAGS;
  try {
    const { data } = await supabase
      .from("team_subscriptions")
      .select(
        "pitch_notify_coach, pitch_notify_team_admin, pitch_notify_subs_manager",
      )
      .eq("team_id", teamId)
      .maybeSingle();
    if (!data) return DEFAULT_FLAGS;
    return {
      coach: data.pitch_notify_coach !== false,
      team_admin: data.pitch_notify_team_admin !== false,
      subs_manager: data.pitch_notify_subs_manager !== false,
    };
  } catch (e) {
    console.error("[pitchBoardNotifyFlags] load failed:", e);
    return DEFAULT_FLAGS;
  }
}

/** Build the role list to pass to `user_roles` queries based on flags. */
export type PitchNotifyRole = "team_admin" | "coach";
export function enabledRoleListFromFlags(flags: PitchNotifyFlags): PitchNotifyRole[] {
  const roles: PitchNotifyRole[] = [];
  if (flags.team_admin) roles.push("team_admin");
  if (flags.coach) roles.push("coach");
  return roles;
}

