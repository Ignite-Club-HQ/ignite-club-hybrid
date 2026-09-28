import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import {
  computeMemberIdentity,
  type MemberIdentity,
  type MemberRole,
} from "@/lib/memberIdentity";
import type { TeamRole } from "./invitationPolicy";

type IgniteSupabaseClient = SupabaseClient<Database>;

export type InvitationMemberProfile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "display_name" | "avatar_url"
>;

export type InvitationClubBranding = Pick<
  Database["public"]["Tables"]["clubs"]["Row"],
  "name" | "logo_url" | "contact_email" | "invite_email_style"
>;

export type InvitationProfileLoader = (
  userIds: readonly (string | null | undefined)[],
) => Promise<{ data: InvitationMemberProfile[] | null }>;

export type InvitationClubChild = Pick<
  Database["public"]["Tables"]["children"]["Row"],
  "id" | "name" | "year_of_birth" | "parent_id"
> & { parent_name: string };

export interface PendingInviteChildMatch {
  id: string;
  name: string;
  year_of_birth: number | string | null;
  parent_name: string;
  parent_id: string;
  isPending: true;
  inviteId: string;
}

export interface InvitableProfileResult {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  masked_email: string | null;
}

export interface PendingInviteSearchResult {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  invited_email: string | null;
  isPendingInvite: true;
  pendingInviteId: string;
  invitedUserId: string | null;
}

export type BulkInvitationCandidate =
  | InvitableProfileResult
  | PendingInviteSearchResult;

export interface BulkInvitationSearchResult {
  term: string;
  results: BulkInvitationCandidate[];
}

export interface BulkParentSearchResult {
  term: string;
  results: InvitationMemberProfile[];
}

type PendingInviteChildMetadata = {
  name?: unknown;
  yearOfBirth?: unknown;
  existingChildId?: unknown;
};

type PendingInviteMetadata = { children?: unknown };

type PendingInviteChildSource = Pick<
  Database["public"]["Tables"]["pending_invites"]["Row"],
  "id" | "invited_label" | "metadata"
>;

export async function fetchTeamMemberIds(
  teamId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string[]> {
  const { data } = await client
    .from("user_roles")
    .select("user_id")
    .eq("team_id", teamId);
  return data?.map((membership) => membership.user_id) ?? [];
}

export async function fetchTeamMemberProfiles(
  userIds: string[],
  loadProfiles: InvitationProfileLoader = selectCachedProfilesByIds,
): Promise<InvitationMemberProfile[]> {
  if (!userIds.length) return [];
  const { data } = await loadProfiles(userIds);
  return data ?? [];
}

export async function fetchInvitationClubBranding(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<InvitationClubBranding | null> {
  const { data } = await client
    .from("clubs")
    .select("name, logo_url, contact_email, invite_email_style")
    .eq("id", clubId)
    .single();
  return data;
}

export async function fetchInvitationClubChildren(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
  loadProfiles: InvitationProfileLoader = selectCachedProfilesByIds,
): Promise<InvitationClubChild[]> {
  const { data: teams } = await client
    .from("teams")
    .select("id")
    .eq("club_id", clubId);

  const childIdsFromTeams = new Set<string>();
  if (teams?.length) {
    const { data: assignments } = await client
      .from("child_team_assignments")
      .select("child_id")
      .in("team_id", teams.map((team) => team.id));
    assignments?.forEach((assignment) => childIdsFromTeams.add(assignment.child_id));
  }

  const { data: clubParents } = await client
    .from("user_roles")
    .select("user_id")
    .eq("club_id", clubId)
    .eq("role", "parent");
  const parentUserIds = [...new Set(clubParents?.map((parent) => parent.user_id) ?? [])];

  const childIdsFromParents = new Set<string>();
  if (parentUserIds.length) {
    const { data: parentChildren } = await client
      .from("children")
      .select("id")
      .in("parent_id", parentUserIds);
    parentChildren?.forEach((child) => childIdsFromParents.add(child.id));
  }

  const childIds = [...new Set([...childIdsFromTeams, ...childIdsFromParents])];
  if (!childIds.length) return [];

  const { data: children } = await client
    .from("children")
    .select("id, name, year_of_birth, parent_id")
    .in("id", childIds);
  if (!children?.length) return [];

  const parentIds = [...new Set(children.map((child) => child.parent_id))];
  const { data: parents } = await loadProfiles(parentIds);
  const parentNames = new Map(
    (parents ?? []).map((parent) => [parent.id, parent.display_name]),
  );

  return children.map((child) => ({
    ...child,
    parent_name: (child.parent_id && parentNames.get(child.parent_id)) || "Unknown",
  }));
}

export function buildPendingInviteChildMatches(
  invites: readonly PendingInviteChildSource[],
): PendingInviteChildMatch[] {
  const inviteLookup = new Map(invites.map((invite) => [invite.id, invite]));
  const pendingChildren = new Map<string, PendingInviteChildMatch>();

  for (const invite of invites) {
    const metadata = invite.metadata as PendingInviteMetadata | null;
    if (!Array.isArray(metadata?.children)) continue;

    for (const rawChild of metadata.children) {
      if (!rawChild || typeof rawChild !== "object") continue;
      const child = rawChild as PendingInviteChildMetadata;
      if (!child.name) continue;

      const normalizedName = String(child.name).trim();
      const referencedPendingInviteId =
        typeof child.existingChildId === "string" &&
        child.existingChildId.startsWith("pending-")
          ? child.existingChildId.replace(/^pending-([^-]+)-.*$/, "$1")
          : null;
      const canonicalInviteId =
        referencedPendingInviteId && inviteLookup.has(referencedPendingInviteId)
          ? referencedPendingInviteId
          : invite.id;
      const canonicalInvite = inviteLookup.get(canonicalInviteId) ?? invite;
      const yearOfBirth = child.yearOfBirth || "";
      const dedupeKey = `${canonicalInviteId}:${normalizedName.toLowerCase()}:${yearOfBirth}`;

      if (!pendingChildren.has(dedupeKey)) {
        pendingChildren.set(dedupeKey, {
          id: `pending-${canonicalInviteId}-${normalizedName}`,
          name: normalizedName,
          year_of_birth:
            typeof child.yearOfBirth === "number" || typeof child.yearOfBirth === "string"
              ? child.yearOfBirth || null
              : null,
          parent_name: canonicalInvite.invited_label || invite.invited_label || "Unknown",
          parent_id: canonicalInviteId,
          isPending: true,
          inviteId: canonicalInviteId,
        });
      }
    }
  }

  return [...pendingChildren.values()];
}

export async function fetchPendingInviteChildren(
  teamId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<PendingInviteChildMatch[]> {
  const { data: invites } = await client
    .from("pending_invites")
    .select("id, invited_label, metadata")
    .eq("team_id", teamId)
    .eq("status", "pending");
  return buildPendingInviteChildMatches(invites ?? []);
}

export async function searchInvitableProfiles(
  query: string,
  client: IgniteSupabaseClient = supabase,
  clubId?: string,
): Promise<InvitableProfileResult[]> {
  if (query.length < 2) return [];
  const { data } = await client.rpc("search_invitable_profiles", {
    _query: query,
    _limit: 8,
    ...(clubId ? { _club_id: clubId } : {}),
  });
  const profiles = (data ?? []) as InvitableProfileResult[];
  if (!clubId || !profiles.length) return profiles;

  const { data: scopedRoles } = await client
    .from("user_roles")
    .select("user_id")
    .eq("club_id", clubId)
    .in("user_id", profiles.map((profile) => profile.id));
  const scopedUserIds = new Set((scopedRoles ?? []).map((role) => role.user_id));
  return profiles.filter((profile) => scopedUserIds.has(profile.id));
}

export async function searchPendingClubInvites(
  query: string,
  clubId: string,
  client: IgniteSupabaseClient = supabase,
  loadProfiles: InvitationProfileLoader = selectCachedProfilesByIds,
): Promise<PendingInviteSearchResult[]> {
  if (query.length < 2) return [];
  const { data: invites } = await client
    .from("pending_invites")
    .select("id, invited_label, invited_email, invited_user_id, metadata, team_id")
    .eq("club_id", clubId)
    .eq("status", "pending")
    .ilike("invited_label", `%${query}%`)
    .limit(12);
  if (!invites?.length) return [];

  const userIds = invites.flatMap((invite) =>
    invite.invited_user_id ? [invite.invited_user_id] : [],
  );
  const profilesById = new Map<string, InvitationMemberProfile>();
  if (userIds.length) {
    const { data: profiles } = await loadProfiles(userIds);
    profiles?.forEach((profile) => profilesById.set(profile.id, profile));
  }

  return invites.map((invite) => ({
    id: `pending-${invite.id}`,
    display_name: invite.invited_user_id
      ? profilesById.get(invite.invited_user_id)?.display_name || invite.invited_label
      : invite.invited_label,
    avatar_url: invite.invited_user_id
      ? profilesById.get(invite.invited_user_id)?.avatar_url || null
      : null,
    invited_email: invite.invited_email,
    isPendingInvite: true,
    pendingInviteId: invite.id,
    invitedUserId: invite.invited_user_id,
  }));
}

export async function searchSecondParentProfiles(
  query: string,
  client: IgniteSupabaseClient = supabase,
): Promise<InvitationMemberProfile[]> {
  if (query.length < 2) return [];
  const { data } = await client
    .from("profiles")
    .select("id, display_name, avatar_url")
    .ilike("display_name", `%${query}%`)
    .limit(5);
  return data ?? [];
}

export async function fetchInvitationIdentityMap(
  clubId: string,
  userIds: string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Record<string, MemberIdentity>> {
  if (!clubId || !userIds.length) return {};

  const [rolesResult, teamsResult, childrenResult] = await Promise.all([
    client
      .from("user_roles")
      .select("user_id, role, team_id")
      .eq("club_id", clubId)
      .in("user_id", userIds),
    client.from("teams").select("id, name").eq("club_id", clubId),
    client
      .from("children")
      .select("parent_id, name")
      .in("parent_id", userIds),
  ]);

  const teamNameById: Record<string, string> = {};
  for (const team of teamsResult.data ?? []) teamNameById[team.id] = team.name;

  const rolesByUser = new Map<string, { role: MemberRole; team_id: string | null }[]>();
  for (const role of rolesResult.data ?? []) {
    const roles = rolesByUser.get(role.user_id) ?? [];
    roles.push({ role: role.role as MemberRole, team_id: role.team_id });
    rolesByUser.set(role.user_id, roles);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const child of childrenResult.data ?? []) {
    if (!child.parent_id || !child.name) continue;
    const names = childrenByParent.get(child.parent_id) ?? [];
    names.push(child.name);
    childrenByParent.set(child.parent_id, names);
  }

  const identities: Record<string, MemberIdentity> = {};
  for (const userId of userIds) {
    identities[userId] = computeMemberIdentity({
      display_name: null,
      roles: rolesByUser.get(userId) ?? [],
      children_names: childrenByParent.get(userId) ?? [],
      teamNameById,
    });
  }
  return identities;
}

export async function searchBulkInvitationCandidates(
  terms: string[],
  context: {
    clubId: string;
    currentUserId?: string;
    selectedRole: TeamRole;
    existingMemberIds?: readonly string[];
  },
  client: IgniteSupabaseClient = supabase,
): Promise<BulkInvitationSearchResult[]> {
  if (!terms.length) return [];

  return Promise.all(terms.map(async (term) => {
    const profiles = await searchInvitableProfiles(term, client, context.clubId);
    const profileResults = profiles.filter(
      (profile) =>
        profile.id === context.currentUserId ||
        context.selectedRole === "parent" ||
        !context.existingMemberIds?.includes(profile.id),
    );

    const { data: invites } = await client
      .from("pending_invites")
      .select("id, invited_label, invited_email, invited_user_id, metadata, team_id")
      .eq("club_id", context.clubId)
      .eq("status", "pending")
      .ilike("invited_label", `%${term}%`)
      .limit(8);
    const profileIds = new Set(profileResults.map((profile) => profile.id));
    const pendingResults: PendingInviteSearchResult[] = (invites ?? [])
      .map((invite) => ({
        id: `pending-${invite.id}`,
        display_name: invite.invited_label,
        avatar_url: null,
        invited_email: invite.invited_email,
        isPendingInvite: true as const,
        pendingInviteId: invite.id,
        invitedUserId: invite.invited_user_id,
      }))
      .filter((invite) => !invite.invitedUserId || !profileIds.has(invite.invitedUserId));

    return { term, results: [...profileResults, ...pendingResults] };
  }));
}

export async function searchBulkSecondParentProfiles(
  terms: string[],
  client: IgniteSupabaseClient = supabase,
): Promise<BulkParentSearchResult[]> {
  if (!terms.length) return [];
  return Promise.all(terms.map(async (term) => ({
    term,
    results: await searchSecondParentProfiles(term, client),
  })));
}
