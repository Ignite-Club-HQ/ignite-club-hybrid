import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { VaultRoleRecord } from "./types";
import { hasVaultProEntitlement } from "./vaultAccess";

type IgniteSupabaseClient = SupabaseClient<Database>;

export type VaultClubSummary = Pick<
  Database["public"]["Tables"]["clubs"]["Row"],
  "id" | "name" | "is_pro" | "storage_used_bytes"
>;

export async function fetchVaultAppAdmin(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  const { data } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "app_admin")
    .maybeSingle();
  return Boolean(data);
}

export async function fetchVaultUserRoles(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultRoleRecord[]> {
  const { data } = await client
    .from("user_roles")
    .select("role, club_id, team_id")
    .eq("user_id", userId);
  return data ?? [];
}

export async function fetchVaultAccessibleClubs(
  userId: string,
  isAppAdmin: boolean,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultClubSummary[]> {
  if (isAppAdmin) {
    const { data } = await client
      .from("clubs")
      .select("id, name, is_pro, storage_used_bytes")
      .order("name");
    return data ?? [];
  }

  const { data: roles } = await client
    .from("user_roles")
    .select("club_id, team_id")
    .eq("user_id", userId);
  if (!roles?.length) return [];

  const clubIds = [...new Set(roles.flatMap((role) => role.club_id ? [role.club_id] : []))];
  const teamIds = roles.flatMap((role) => role.team_id ? [role.team_id] : []);

  if (teamIds.length) {
    const { data: teams } = await client
      .from("teams")
      .select("club_id")
      .in("id", teamIds);
    for (const team of teams ?? []) {
      if (team.club_id && !clubIds.includes(team.club_id)) clubIds.push(team.club_id);
    }
  }

  if (!clubIds.length) return [];
  const { data: clubs } = await client
    .from("clubs")
    .select("id, name, is_pro, storage_used_bytes")
    .in("id", clubIds);
  return clubs ?? [];
}

export async function fetchVaultClubHasPro(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  const { data } = await client
    .from("club_subscriptions")
    .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
    .eq("club_id", clubId)
    .maybeSingle();
  return hasVaultProEntitlement(data);
}

export async function fetchVaultTeamHasPro(
  teamId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  const { data } = await client
    .from("team_subscriptions")
    .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
    .eq("team_id", teamId)
    .maybeSingle();
  return hasVaultProEntitlement(data);
}

export async function fetchVaultAnyProAccess(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  const { data: roles } = await client
    .from("user_roles")
    .select("club_id, team_id")
    .eq("user_id", userId);
  if (!roles?.length) return false;

  const directClubIds = roles.flatMap((role) => role.club_id ? [role.club_id] : []);
  const teamIds = roles.flatMap((role) => role.team_id ? [role.team_id] : []);
  const allClubIds = [...directClubIds];

  if (teamIds.length) {
    const { data: teams } = await client
      .from("teams")
      .select("id, club_id")
      .in("id", teamIds);
    for (const team of teams ?? []) {
      if (team.club_id && !allClubIds.includes(team.club_id)) allClubIds.push(team.club_id);
    }
  }

  if (allClubIds.length) {
    const { data: clubSubscriptions } = await client
      .from("club_subscriptions")
      .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
      .in("club_id", allClubIds);
    if (clubSubscriptions?.some(hasVaultProEntitlement)) return true;
  }

  if (teamIds.length) {
    const { data: teamSubscriptions } = await client
      .from("team_subscriptions")
      .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
      .in("team_id", teamIds);
    if (teamSubscriptions?.some(hasVaultProEntitlement)) return true;
  }

  if (allClubIds.length) {
    const { data: legacyProClubs } = await client
      .from("clubs")
      .select("is_pro")
      .in("id", allClubIds)
      .eq("is_pro", true);
    return Boolean(legacyProClubs?.length);
  }

  return false;
}
