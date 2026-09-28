import {
  EVENT_MANAGER_ROLES,
  hasEventManagerRole,
} from "./eventManagerPolicy";

type EventAccessScope = {
  clubId: string;
  teamId?: string | null;
  miniLeagueId?: string | null;
};

type ProRow = {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
};

const hasAnyPro = (row: ProRow | null | undefined) =>
  !!(
    row?.is_pro ||
    row?.is_pro_football ||
    row?.admin_pro_override ||
    row?.admin_pro_football_override
  );

const hasFootballPro = (row: ProRow | null | undefined) =>
  !!(row?.is_pro_football || row?.admin_pro_football_override);

export async function fetchIsAppAdmin(client: any, userId: string): Promise<boolean> {
  const { data } = await client
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "app_admin")
    .maybeSingle();
  return !!data;
}

/** Resolve UI management capability; RLS/RPC authorization remains authoritative. */
export async function fetchCanManageEvent(
  client: any,
  userId: string,
  event: EventAccessScope,
): Promise<boolean> {
  const { data: clubRoles } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("club_id", event.clubId)
    .in("role", [...EVENT_MANAGER_ROLES.club])
    .limit(1);
  if (hasEventManagerRole("club", clubRoles)) return true;

  if (event.teamId) {
    const { data: teamRoles } = await client
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("team_id", event.teamId)
      .in("role", [...EVENT_MANAGER_ROLES.team]);
    if (hasEventManagerRole("team", teamRoles)) return true;
  }

  if (event.miniLeagueId) {
    const { data: leagueRoles } = await client
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("club_id", event.clubId)
      .in("role", [...EVENT_MANAGER_ROLES.miniLeague]);
    if (hasEventManagerRole("miniLeague", leagueRoles)) return true;
  }
  return false;
}

export async function fetchEventProFootballAccess(
  client: any,
  teamId: string,
  clubId?: string | null,
): Promise<boolean> {
  const { data: teamSubscription } = await client
    .from("team_subscriptions")
    .select("is_pro_football, admin_pro_football_override")
    .eq("team_id", teamId)
    .maybeSingle();
  if (hasFootballPro(teamSubscription)) return true;
  if (!clubId) return false;

  const { data: clubSubscription } = await client
    .from("club_subscriptions")
    .select("is_pro_football, admin_pro_football_override")
    .eq("club_id", clubId)
    .maybeSingle();
  return hasFootballPro(clubSubscription);
}

export async function fetchEventProAccess(
  client: any,
  teamId?: string | null,
  clubId?: string | null,
): Promise<boolean> {
  if (teamId) {
    const { data: teamSubscription } = await client
      .from("team_subscriptions")
      .select(
        "is_pro, is_pro_football, admin_pro_override, admin_pro_football_override",
      )
      .eq("team_id", teamId)
      .maybeSingle();
    if (hasAnyPro(teamSubscription)) return true;
  }
  if (!clubId) return false;

  const { data: clubSubscription } = await client
    .from("club_subscriptions")
    .select(
      "is_pro, is_pro_football, admin_pro_override, admin_pro_football_override",
    )
    .eq("club_id", clubId)
    .maybeSingle();
  return hasAnyPro(clubSubscription);
}
