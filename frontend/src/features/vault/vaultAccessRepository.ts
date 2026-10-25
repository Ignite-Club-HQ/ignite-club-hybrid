import { acrossLists } from "@/live/featureScopes";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { withFeatureBackend, type FeatureBackendContext } from "@/live/featureRouter";
import type { VaultRoleRecord } from "./types";
import { hasVaultProEntitlement } from "./vaultAccess";

type IgniteSupabaseClient = SupabaseClient<Database>;

/** Scoped capacity authority; personal/global Pro never unlocks club files. */
async function scopedVaultPro(ctx: FeatureBackendContext, clubId: string, teamId: string | null = null): Promise<boolean> {
  const { connectLiveClubDomain } = await import("@/live/domains");
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  const allowance = await actor.get_media_allowance(clubId, teamId ? [teamId] : []);
  if ("Err" in allowance) throw new Error(allowance.Err);
  return allowance.Ok.premium;
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
      const { data, error } = await client
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "app_admin")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    icp: async (ctx) => {
      const { isLiveAppAdmin } = await import("@/live/features/insights");
      return isLiveAppAdmin(ctx);
    },
  }, { shared: "app" });
}

export async function fetchVaultUserRoles(
  userId: string,
  client: IgniteSupabaseClient = supabase,
  selectedClubId?: string | null,
): Promise<VaultRoleRecord[]> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { data, error } = await client
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", userId);
      if (error) throw error;
      return data ?? [];
    },
    icp: async (ctx) => {
      // Caller-scoped: club_domain my_role_grants replaces the user_roles
      // rows keyed by the II principal.
      const { getLiveMyRoleGrants } = await import("@/live/features/membership");
      const grants = await getLiveMyRoleGrants(ctx);
      return grants.filter((grant) => !selectedClubId || grant.club[0] === selectedClubId).map((grant) => ({
        role: grant.role,
        club_id: grant.club[0] ?? null,
        team_id: grant.team[0] ?? null,
      }));
    },
  }, selectedClubId ? { clubId: selectedClubId } : { shared: "person" });
}

/** One group stuck (e.g. a service out of fuel) must not hold back the rest. */
const VAULT_GROUP_READ_MS = 15_000;

export async function fetchVaultAccessibleClubs(
  userId: string,
  isAppAdmin: boolean,
  client: IgniteSupabaseClient = supabase,
  selectedClubId?: string | null,
): Promise<VaultClubSummary[]> {
  // A known theme club is a location hint, not an access grant. Read it
  // through its exact owning group; the destination still checks the caller.
  if (selectedClubId) {
    return withFeatureBackend("vault", {
      supabase: async () => {
        const { data, error } = await client.from("clubs")
          .select("id, name, is_pro, storage_used_bytes").eq("id", selectedClubId).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("The selected club could not be loaded. Please try again.");
        return [data];
      },
      icp: async (ctx) => {
        const { getLiveClubProfile } = await import("@/live/features/club");
        const { withReadDeadline } = await import("@/live/readDeadline");
        return withReadDeadline((async () => {
          const [clubs, premium] = await Promise.all([
            getLiveClubProfile(ctx, selectedClubId), scopedVaultPro(ctx, selectedClubId),
          ]);
          const club = clubs[0];
          if (!club || club.deleted_at_ms?.length) throw new Error("The selected club could not be loaded. Please try again.");
          return [{ id: club.id, name: club.name, is_pro: premium, storage_used_bytes: 0 }];
        })(), "Selected Vault club", VAULT_GROUP_READ_MS);
      },
    }, { clubId: selectedClubId });
  }
  // Asked once per lookup, not once per group: membership comes from the
  // already-open routing session and the IAP entitlement lives on identity.
  let memberIdsOnce: Promise<string[] | null> | undefined;
  if (!isAppAdmin) {
    // Members: read only their own clubs, each in its owning group, instead of
    // listing every club on every group and waiting for the slowest group.
    return withFeatureBackend("vault", {
      supabase: async () => fetchVaultAccessibleClubsSupabase(userId, isAppAdmin, client),
      icp: async (ctx) => {
        void import("@/live/features/vault").then(v => v.recoverLiveVaultPendingUploads(ctx)).catch(() => { /* uncertain outcomes stay reserved */ });
        const [{ clubDispatch }, { readClubsInOwnGroups }, { listLiveClubSubscriptions, liveHasAnyPro }, { withReadDeadline }] = await Promise.all([
          import("@/live/groupDispatch"), import("@/live/crossGroupClubs"), import("@/live/features/proAccess"), import("@/live/readDeadline")]);
        return withReadDeadline((async () => {
          const memberIds = await clubDispatch.memberClubIds();
          if (memberIds.length === 0) return [];
          const [profiles, subs] = await Promise.all([readClubsInOwnGroups(ctx, memberIds), listLiveClubSubscriptions(ctx, memberIds)]);
          if (profiles.values.length === 0 && profiles.failed > 0) throw new Error("Vault clubs could not be loaded");
          return profiles.values.map((club) => ({ id: club.id, name: club.name, is_pro: liveHasAnyPro(subs.get(club.id)), storage_used_bytes: 0 }));
        })(), "Vault clubs", VAULT_GROUP_READ_MS);
      },
    }, { shared: "person" });
  }
  return withFeatureBackend("vault", {
    supabase: async () => fetchVaultAccessibleClubsSupabase(userId, isAppAdmin, client),
    icp: async (ctx) => {
      // Each group scans only this owner's journal, independently of opened clubs.
      void import("@/live/features/vault").then(v => v.recoverLiveVaultPendingUploads(ctx)).catch(() => { /* uncertain outcomes stay reserved */ });
      const { listLiveClubs } = await import("@/live/features/club");
      const { listLiveClubSubscriptions, liveHasAnyPro } = await import("@/live/features/proAccess");
      const { clubDispatch } = await import("@/live/groupDispatch");
      const { withReadDeadline } = await import("@/live/readDeadline");
      memberIdsOnce ??= isAppAdmin ? Promise.resolve(null) : clubDispatch.memberClubIds();
      // Entitlement failure only drops global IAP Pro; club grants still apply.
      return withReadDeadline((async () => {
        const [rows, memberIds] = await Promise.all([listLiveClubs(ctx), (memberIdsOnce ?? Promise.resolve(null))]);
        const clubs = rows.filter(club => (!memberIds || memberIds.includes(club.id)) && !club.deleted_at_ms?.length);
        if (clubs.length === 0) return [];
        // Per-club "Free Pro" grants from club_domain plus the caller's own
        // IAP entitlement (global Pro for its holder).
        const subs = await listLiveClubSubscriptions(ctx, clubs.map(club => club.id));
        // Subscription flags here label clubs; scoped actions read media allowance.
        return clubs.map((club) => ({
          id: club.id,
          name: club.name,
          is_pro: liveHasAnyPro(subs.get(club.id)),
          storage_used_bytes: 0,
        }));
      })(), "Vault clubs", VAULT_GROUP_READ_MS);
    },
    // Shared + every group, each answering for itself: a failing group no
    // longer empties the whole list (member-group reads fail all-or-nothing).
  }, acrossLists);
}

async function fetchVaultAccessibleClubsSupabase(
  userId: string,
  isAppAdmin: boolean,
  client: IgniteSupabaseClient,
): Promise<VaultClubSummary[]> {
  if (isAppAdmin) {
    const { data, error } = await client
      .from("clubs")
      .select("id, name, is_pro, storage_used_bytes")
      .order("name");
    if (error) throw error;
      return data ?? [];
  }

  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("club_id, team_id")
    .eq("user_id", userId);
  if (rolesError) throw rolesError;
  if (!roles?.length) return [];

  const clubIds = [...new Set(roles.flatMap((role) => role.club_id ? [role.club_id] : []))];
  const teamIds = roles.flatMap((role) => role.team_id ? [role.team_id] : []);

  if (teamIds.length) {
    const { data: teams, error: teamsError } = await client
      .from("teams")
      .select("club_id")
      .in("id", teamIds);
    if (teamsError) throw teamsError;
    for (const team of teams ?? []) {
      if (team.club_id && !clubIds.includes(team.club_id)) clubIds.push(team.club_id);
    }
  }

  if (!clubIds.length) return [];
  const { data: clubs, error: clubsError } = await client
    .from("clubs")
    .select("id, name, is_pro, storage_used_bytes")
    .in("id", clubIds);
  if (clubsError) throw clubsError;
  return clubs ?? [];
}

export async function fetchVaultClubHasPro(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { data, error } = await client
        .from("club_subscriptions")
    .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
    .eq("club_id", clubId)
    .maybeSingle();
      if (error) throw error;
      return hasVaultProEntitlement(data);
    },
    // Club "Free Pro" grant on club_domain, or the caller's IAP entitlement.
    icp: async (ctx) => {
      return scopedVaultPro(ctx, clubId);
    },
  }, { clubId });
}

export async function fetchVaultTeamHasPro(
  teamId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { data, error } = await client
        .from("team_subscriptions")
    .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
    .eq("team_id", teamId)
    .maybeSingle();
      if (error) throw error;
      return hasVaultProEntitlement(data);
    },
    // Team grant → owning club's grant → caller's IAP entitlement.
    icp: async (ctx) => {
      const { getLiveTeam } = await import("@/live/features/club");
      const [team] = await getLiveTeam(ctx, teamId);
      return team ? scopedVaultPro(ctx, team.club_id, teamId) : false;
    },
  }, { teamId });
}

export interface VaultCompetitionAccess {
  isMember: boolean;
  canManage: boolean;
}

export async function fetchVaultCompetitionAccess(
  competitionId: string,
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultCompetitionAccess> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const [{ data: canAccess, error: accessError }, { data: canManage, error: manageError }] = await Promise.all([
        client.rpc("can_access_competition_vault", { _competition_id: competitionId }),
        client.rpc("is_competition_admin", { _user_id: userId, _competition_id: competitionId }),
      ]);
      if (accessError) throw accessError;
      if (manageError) throw manageError;
      return { isMember: Boolean(canAccess), canManage: Boolean(canManage) };
    },
    icp: async (ctx) => {
      const [{ listLiveVaultFolders }, { isLiveCompetitionAdmin }] = await Promise.all([
        import("@/live/features/vault"),
        import("@/live/features/competitions"),
      ]);
      await listLiveVaultFolders(ctx, "", null, null, competitionId);
      const canManage = await isLiveCompetitionAdmin(ctx, competitionId);
      return { isMember: true, canManage };
    },
  }, { competitionId });
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
      return false;
    },
  }, { memberGroups: true, merge: (parts: boolean[]) => parts.some(Boolean) });
}

async function fetchVaultAnyProAccessSupabase(
  userId: string,
  client: IgniteSupabaseClient,
): Promise<boolean> {
  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("club_id, team_id")
    .eq("user_id", userId);
  if (rolesError) throw rolesError;
  if (!roles?.length) return false;

  const directClubIds = roles.flatMap((role) => role.club_id ? [role.club_id] : []);
  const teamIds = roles.flatMap((role) => role.team_id ? [role.team_id] : []);
  const allClubIds = [...directClubIds];

  if (teamIds.length) {
    const { data: teams, error: teamsError } = await client
      .from("teams")
      .select("id, club_id")
      .in("id", teamIds);
    if (teamsError) throw teamsError;
    for (const team of teams ?? []) {
      if (team.club_id && !allClubIds.includes(team.club_id)) allClubIds.push(team.club_id);
    }
  }

  if (allClubIds.length) {
    const { data: clubSubscriptions, error: clubError } = await client
      .from("club_subscriptions")
      .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
      .in("club_id", allClubIds);
    if (clubError) throw clubError;
    if (clubSubscriptions?.some(hasVaultProEntitlement)) return true;
  }

  if (teamIds.length) {
    const { data: teamSubscriptions, error: teamError } = await client
      .from("team_subscriptions")
      .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
      .in("team_id", teamIds);
    if (teamError) throw teamError;
    if (teamSubscriptions?.some(hasVaultProEntitlement)) return true;
  }

  if (allClubIds.length) {
    const { data: legacyProClubs, error: legacyError } = await client
      .from("clubs")
      .select("is_pro")
      .in("id", allClubIds)
      .eq("is_pro", true);
    if (legacyError) throw legacyError;
    return Boolean(legacyProClubs?.length);
  }

  return false;
}
