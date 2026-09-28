type ProEntitlementRow = {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
};

export type HomeRewardClub = {
  id: string;
  name: string;
  logo_url: string | null;
  hasPro: boolean;
};

const SUBSCRIPTION_SELECT =
  "club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override";

function hasProEntitlement(row: ProEntitlementRow | null | undefined): boolean {
  return !!(
    row?.is_pro ||
    row?.is_pro_football ||
    row?.admin_pro_override ||
    row?.admin_pro_football_override
  );
}

/**
 * Resolve the Home-level Pro badge across all current memberships. This keeps
 * the legacy teams.is_pro trial fallback used by website trial signups.
 * Missing/failed read payloads deliberately fail closed to non-Pro, matching
 * the previous Home behaviour.
 */
export async function fetchHomeProAccess(
  client: any,
  clubIds: readonly string[],
  teamIds: readonly string[],
): Promise<boolean> {
  if (clubIds.length === 0 && teamIds.length === 0) return false;

  const [clubSubsResult, teamSubsResult, teamsResult] = await Promise.all([
    clubIds.length > 0
      ? client
          .from("club_subscriptions")
          .select(SUBSCRIPTION_SELECT)
          .in("club_id", [...clubIds])
      : Promise.resolve({ data: [] }),
    teamIds.length > 0
      ? client
          .from("team_subscriptions")
          .select(
            "team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override",
          )
          .in("team_id", [...teamIds])
      : Promise.resolve({ data: [] }),
    teamIds.length > 0
      ? client
          .from("teams")
          .select("id, is_pro")
          .in("id", [...teamIds])
          .is("deleted_at", null)
      : Promise.resolve({ data: [] }),
  ]);

  if ((clubSubsResult.data ?? []).some(hasProEntitlement)) return true;
  if ((teamSubsResult.data ?? []).some(hasProEntitlement)) return true;
  return (teamsResult.data ?? []).some((team: { is_pro?: boolean | null }) => team.is_pro);
}

/** Read reward-capable clubs for either the active club or all club memberships. */
export async function fetchHomeRewardClubs(
  client: any,
  clubIds: readonly string[],
  activeClubId: string | null | undefined,
): Promise<HomeRewardClub[]> {
  if (activeClubId) {
    const [clubResult, subscriptionResult] = await Promise.all([
      client.from("clubs").select("id, name, logo_url").eq("id", activeClubId).single(),
      client
        .from("club_subscriptions")
        .select(SUBSCRIPTION_SELECT)
        .eq("club_id", activeClubId)
        .maybeSingle(),
    ]);

    if (!clubResult.data) return [];
    return [{ ...clubResult.data, hasPro: hasProEntitlement(subscriptionResult.data) }];
  }

  if (clubIds.length === 0) return [];
  const [clubsResult, subscriptionsResult] = await Promise.all([
    client.from("clubs").select("id, name, logo_url").in("id", [...clubIds]),
    client
      .from("club_subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .in("club_id", [...clubIds]),
  ]);

  return (clubsResult.data ?? []).map((club: Omit<HomeRewardClub, "hasPro">) => {
    const subscription = (subscriptionsResult.data ?? []).find(
      (row: { club_id?: string }) => row.club_id === club.id,
    );
    return { ...club, hasPro: hasProEntitlement(subscription) };
  });
}
