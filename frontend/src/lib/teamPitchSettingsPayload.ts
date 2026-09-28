/**
 * Builds the `team_subscriptions` upsert payload for a single Pitch Settings
 * field change. Every field defaults to the current `teamSubscription` value
 * (or a sane fallback) so a single-field edit never clobbers the rest of the
 * row. Pure and side-effect free — the caller owns the actual Supabase call.
 */
export interface TeamPitchSettingsSource {
  team_size?: number | null;
  formation?: string | null;
  minutes_per_half?: number | null;
  rotation_speed?: number | null;
  disable_auto_subs?: boolean | null;
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  disable_position_swaps?: boolean | null;
}

export interface TeamPitchSettingsOverrides {
  team_size?: number;
  formation?: string | null;
  minutes_per_half?: number;
  rotation_speed?: number;
  disable_auto_subs?: boolean;
  disable_position_swaps?: boolean;
}

export function buildTeamPitchSettingsPayload(
  teamId: string,
  current: TeamPitchSettingsSource | null | undefined,
  defaultMinutesPerHalf: number,
  overrides: TeamPitchSettingsOverrides,
) {
  return {
    team_id: teamId,
    team_size: overrides.team_size ?? current?.team_size ?? 7,
    formation: overrides.formation !== undefined ? overrides.formation : current?.formation ?? null,
    minutes_per_half: overrides.minutes_per_half ?? current?.minutes_per_half ?? defaultMinutesPerHalf,
    rotation_speed: overrides.rotation_speed ?? current?.rotation_speed ?? 1,
    disable_auto_subs: overrides.disable_auto_subs ?? current?.disable_auto_subs ?? false,
    disable_position_swaps: overrides.disable_position_swaps ?? current?.disable_position_swaps ?? false,
    is_pro: current?.is_pro || false,
    is_pro_football: current?.is_pro_football || false,
  };
}
