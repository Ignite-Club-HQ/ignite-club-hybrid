import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { withFeatureBackend, type FeatureBackendContext } from "@/live/featureRouter";
import type { VaultRoleRecord } from "./types";
import { hasVaultProEntitlement } from "./vaultAccess";

type IgniteSupabaseClient = SupabaseClient<Database>;

/**
 * ICP Pro is a per-principal IAP entitlement (identity_access canister) with
 * no per-club/per-team product mapping — mirroring useIcpProAccess, any
 * active entitlement counts as Pro for every vault context the member can
 * see. The live modules are imported dynamically so the Supabase bundle
 * never pulls in the ICP agent SDK.
 */
async function fetchIcpCallerIsPro(ctx: FeatureBackendContext): Promise<boolean> {
  const { fetchIcpEntitlements } = await import("@/live/identityEntitlements");
  const principal = ctx.identity.getPrincipal().toText();
  const summary = await fetchIcpEntitlements(ctx.identity, principal, ctx.target);
  return summary.isPro;
}

export type VaultClubSummary = Pick<
  Database["public"]["Tables"]["clubs"]["Row"],
  "id" | "name" | "is_pro" | "storage_used_bytes"
>;

export async function fetchVaultAppAdmin(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { data } = await client
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "app_admin")
        .maybeSingle();
      return Boolean(data);
    },
    icp: async (ctx) => {
      const { isLiveAppAdmin } = await import("@/live/features/insights");
      return isLiveAppAdmin(ctx);
    },
  });
}

export async function fetchVaultUserRoles(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultRoleRecord[]> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { data } = await client
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", userId);
      return data ?? [];
    },
    icp: async (ctx) => {
      // Caller-scoped: club_domain my_role_grants replaces the user_roles
      // rows keyed by the II principal.
      const { getLiveMyRoleGrants } = await import("@/live/features/membership");
      const grants = await getLiveMyRoleGrants(ctx);
      return grants.map((grant) => ({
        role: grant.role,
        club_id: grant.club[0] ?? null,
        team_id: grant.team[0] ?? null,
      }));
    },
  });
}

export async function fetchVaultAccessibleClubs(
  userId: string,
  isAppAdmin: boolean,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultClubSummary[]> {
  return withFeatureBackend("vault", {
    supabase: async () => fetchVaultAccessibleClubsSupabase(userId, isAppAdmin, client),
    icp: async (ctx) => {
      const { listLiveClubs } = await import("@/live/features/club");
      const { listLiveClubSubscriptions, liveHasAnyPro } = await import("@/live/features/proAccess");
      const clubs = await listLiveClubs(ctx);
      // Per-club "Free Pro" grants from club_domain plus the caller's own
      // IAP entitlement (global Pro for its holder).
      const [subs, callerIsPro] = await Promise.all([
        listLiveClubSubscriptions(ctx, clubs.map((club) => club.id)),
        fetchIcpCallerIsPro(ctx),
      ]);
      // Byte accounting for the storage bar stays on Supabase (media bytes
      // are an approved Supabase area); ICP reports 0 so the bar renders
      // empty rather than erroring.
      return clubs.map((club) => ({
        id: club.id,
        name: club.name,
        is_pro: callerIsPro || liveHasAnyPro(subs.get(club.id)),
        storage_used_bytes: 0,
      }));
    },
  });
}

async function fetchVaultAccessibleClubsSupabase(
  userId: string,
  isAppAdmin: boolean,
  client: IgniteSupabaseClient,
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
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { data } = await client
        .from("club_subscriptions")
    .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
    .eq("club_id", clubId)
    .maybeSingle();
      return hasVaultProEntitlement(data);
    },
    // Club "Free Pro" grant on club_domain, or the caller's IAP entitlement.
    icp: async (ctx) => {
      const { resolveLiveProAccess } = await import("@/live/features/proAccess");
      return resolveLiveProAccess(ctx, { clubId });
    },
  });
}

export async function fetchVaultTeamHasPro(
  teamId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { data } = await client
        .from("team_subscriptions")
    .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
    .eq("team_id", teamId)
    .maybeSingle();
      return hasVaultProEntitlement(data);
    },
    // Team grant → owning club's grant → caller's IAP entitlement.
    icp: async (ctx) => {
      const { getLiveTeam } = await import("@/live/features/club");
      const { resolveLiveProAccess } = await import("@/live/features/proAccess");
      const team = await getLiveTeam(ctx, teamId).catch(() => null);
      return resolveLiveProAccess(ctx, { teamId, clubId: team?.club_id ?? null });
    },
  });
}

export async function fetchVaultAnyProAccess(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  return withFeatureBackend("vault", {
    supabase: async () => fetchVaultAnyProAccessSupabase(userId, client),
    icp: async (ctx) => {
      // Any Pro grant across the caller's clubs/teams, or their own IAP.
      const { getLiveMyRoleGrants } = await import("@/live/features/membership");
      const { listLiveTeamSubscriptions, listLiveClubSubscriptions, liveHasAnyPro } =
        await import("@/live/features/proAccess");
      const grants = await getLiveMyRoleGrants(ctx);
      const clubIds = [...new Set(grants.flatMap((g) => (g.club[0] ? [g.club[0]] : [])))];
      const teamIds = [...new Set(grants.flatMap((g) => (g.team[0] ? [g.team[0]] : [])))];
      const [teamSubs, clubSubs] = await Promise.all([
        listLiveTeamSubscriptions(ctx, teamIds),
        listLiveClubSubscriptions(ctx, clubIds),
      ]);
      if ([...teamSubs.values()].some(liveHasAnyPro)) return true;
      if ([...clubSubs.values()].some(liveHasAnyPro)) return true;
      return fetchIcpCallerIsPro(ctx);
    },
  });
}

async function fetchVaultAnyProAccessSupabase(
  userId: string,
  client: IgniteSupabaseClient,
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
