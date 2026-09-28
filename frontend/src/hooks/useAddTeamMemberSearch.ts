import { useQuery } from "@tanstack/react-query";
import {
  computeMemberIdentity,
  type MemberIdentity,
  type MemberRole,
} from "@/lib/memberIdentity";
import { selectCachedProfilesByIds } from "@/lib/profileCache";

type SearchProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  masked_email?: string | null;
};

type SearchMember = {
  name: string;
  role: string;
  selectedUser?: SearchProfile | null;
  secondParentSearch?: string;
  selectedSecondParent?: SearchProfile | null;
};

type UseAddTeamMemberSearchArgs = {
  supabase: any;
  open: boolean;
  mode: "single" | "bulk";
  clubId: string;
  teamId: string;
  debouncedNameInput: string;
  debouncedSecondParentSearch: string;
  selectedUser: SearchProfile | null;
  selectedSecondParent: SearchProfile | null;
  bulkMembers: SearchMember[];
};

function getPendingInviteChildName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const children = (metadata as { children?: unknown }).children;
  if (Array.isArray(children) && children.length > 0) {
    const first = children[0] as { name?: unknown };
    if (first?.name) return String(first.name).trim();
  }
  return null;
}

export function useAddTeamMemberSearch({
  supabase,
  open,
  mode,
  clubId,
  teamId,
  debouncedNameInput,
  debouncedSecondParentSearch,
  selectedUser,
  selectedSecondParent,
  bulkMembers,
}: UseAddTeamMemberSearchArgs) {
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["user-search-team-member", debouncedNameInput, clubId],
    queryFn: async () => {
      if (debouncedNameInput.length < 2) return [];
      const { data, error } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedNameInput,
        _limit: 8,
        _club_id: clubId ?? null,
      });
      if (error) throw error;
      return (data || []) as SearchProfile[];
    },
    enabled: debouncedNameInput.length >= 2,
  });

  const { data: pendingInviteResults = [] } = useQuery({
    queryKey: ["pending-invite-search", debouncedNameInput, clubId, teamId],
    queryFn: async () => {
      if (debouncedNameInput.length < 2) return [];
      const { data: invites } = await supabase
        .from("pending_invites")
        .select("id, invited_label, invited_email, invited_user_id, metadata, team_id, role")
        .eq("club_id", clubId)
        .eq("status", "pending")
        .ilike("invited_label", `%${debouncedNameInput}%`)
        .limit(12);

      if (!invites?.length) return [];

      const teamIds = Array.from(
        new Set<string>(
          invites
            .filter((invite: { team_id: string | null }) => invite.team_id)
            .map((invite: { team_id: string }) => invite.team_id),
        ),
      );
      const teamNameById: Record<string, string> = {};
      if (teamIds.length > 0 && clubId) {
        const { data: teams } = await supabase
          .from("teams")
          .select("id, name")
          .in("id", teamIds)
          .eq("club_id", clubId);
        for (const team of teams || []) {
          teamNameById[team.id] = team.name;
        }
      }

      const userIds = invites
        .filter((invite: { invited_user_id: string | null }) => invite.invited_user_id)
        .map((invite: { invited_user_id: string }) => invite.invited_user_id);
      const profileMap = new Map<
        string,
        { display_name: string | null; avatar_url: string | null }
      >();
      if (userIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(userIds);
        profiles?.forEach((profile) => profileMap.set(profile.id, profile));
      }

      return invites.map((invite: any) => ({
        id: invite.invited_user_id || `pending-${invite.id}`,
        display_name: invite.invited_user_id
          ? profileMap.get(invite.invited_user_id)?.display_name || invite.invited_label
          : invite.invited_label,
        avatar_url: invite.invited_user_id
          ? profileMap.get(invite.invited_user_id)?.avatar_url || null
          : null,
        invited_email: invite.invited_email,
        isPendingInvite: true,
        pendingInviteId: invite.id,
        role: invite.role,
        teamId: invite.team_id,
        teamName: invite.team_id ? teamNameById[invite.team_id] || null : null,
        childName: getPendingInviteChildName(invite.metadata),
      }));
    },
    enabled: debouncedNameInput.length >= 2,
  });

  const identityLookupIds = Array.from(
    new Set([
      ...searchResults.map((result) => result.id),
      ...pendingInviteResults
        .filter((result) => !result.id.startsWith("pending-"))
        .map((result) => result.id),
    ]),
  );

  const { data: identityMap = {} } = useQuery({
    queryKey: ["invite-search-identities", clubId, [...identityLookupIds].sort().join(",")],
    queryFn: async (): Promise<Record<string, MemberIdentity>> => {
      if (identityLookupIds.length === 0 || !clubId) return {};

      const [rolesRes, teamsRes, childrenRes] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id, role, team_id")
          .eq("club_id", clubId)
          .in("user_id", identityLookupIds),
        supabase.from("teams").select("id, name").eq("club_id", clubId),
        supabase
          .from("children")
          .select("id, parent_id, name")
          .in("parent_id", identityLookupIds),
      ]);

      const teamNameById: Record<string, string> = {};
      for (const team of teamsRes.data || []) teamNameById[team.id] = team.name;

      const rolesByUser = new Map<string, { role: MemberRole; team_id: string | null }[]>();
      for (const roleRow of rolesRes.data || []) {
        const roles = rolesByUser.get(roleRow.user_id) || [];
        roles.push({ role: roleRow.role as MemberRole, team_id: roleRow.team_id });
        rolesByUser.set(roleRow.user_id, roles);
      }

      const candidateChildren = (childrenRes.data || []).filter(
        (child: any) => child.id && child.parent_id && child.name,
      );
      const candidateIds = candidateChildren.map((child: any) => child.id as string);
      const inClubChildIds = new Set<string>();

      if (candidateIds.length) {
        const clubTeamIds = Object.keys(teamNameById);
        const [assignRes, pointsRes, miniLeagueRes] = await Promise.all([
          clubTeamIds.length
            ? supabase
                .from("child_team_assignments")
                .select("child_id")
                .in("child_id", candidateIds)
                .in("team_id", clubTeamIds)
            : Promise.resolve({ data: [] as any[] }),
          supabase
            .from("child_club_points")
            .select("child_id")
            .in("child_id", candidateIds)
            .eq("club_id", clubId),
          supabase
            .from("child_mini_league_assignments")
            .select("child_id, mini_leagues!inner(club_id)")
            .in("child_id", candidateIds)
            .eq("mini_leagues.club_id", clubId),
        ]);
        (assignRes.data as any[] | null)?.forEach((row) => inClubChildIds.add(row.child_id));
        (pointsRes.data as any[] | null)?.forEach((row) => inClubChildIds.add(row.child_id));
        (miniLeagueRes.data as any[] | null)?.forEach((row) => inClubChildIds.add(row.child_id));
      }

      const childrenByParent = new Map<string, string[]>();
      for (const child of candidateChildren) {
        if (!inClubChildIds.has(child.id as string)) continue;
        const children = childrenByParent.get(child.parent_id as string) || [];
        children.push(child.name as string);
        childrenByParent.set(child.parent_id as string, children);
      }

      const identities: Record<string, MemberIdentity> = {};
      for (const id of identityLookupIds) {
        identities[id] = computeMemberIdentity({
          display_name: null,
          roles: rolesByUser.get(id) || [],
          children_names: childrenByParent.get(id) || [],
          teamNameById,
        });
      }
      return identities;
    },
    enabled: identityLookupIds.length > 0 && !!clubId,
    staleTime: 60 * 1000,
  });

  const profileIds = new Set(searchResults.map((result) => result.id));
  const filteredPendingResults = pendingInviteResults.filter(
    (result) => !profileIds.has(result.id),
  );

  const bulkSearchTerms = Array.from(
    new Set(
      bulkMembers
        .filter((member) => !member.selectedUser && member.name.trim().length >= 2)
        .map((member) => member.name.trim()),
    ),
  );
  const { data: bulkSearchResults = [] } = useQuery({
    queryKey: ["bulk-user-search-team-member", bulkSearchTerms, clubId, teamId],
    queryFn: async () => {
      const searches = await Promise.all(
        bulkSearchTerms.map(async (term) => {
          const { data: rpcData } = await supabase.rpc("search_invitable_profiles", {
            _query: term,
            _limit: 8,
            _club_id: clubId ?? null,
          });
          const profileResults = (rpcData || []) as SearchProfile[];
          const { data: invites } = await supabase
            .from("pending_invites")
            .select("id, invited_label, invited_email, invited_user_id, metadata, team_id")
            .eq("club_id", clubId)
            .eq("status", "pending")
            .ilike("invited_label", `%${term}%`)
            .limit(8);
          const resultProfileIds = new Set(profileResults.map((result) => result.id));
          const pendingResults = (invites || [])
            .map((invite: any) => ({
              id: invite.invited_user_id || `pending-${invite.id}`,
              display_name: invite.invited_label,
              avatar_url: null,
              isPendingInvite: true,
              pendingInviteId: invite.id,
              invited_email: invite.invited_email,
            }))
            .filter((result: { id: string }) => !resultProfileIds.has(result.id));
          return { term, results: [...profileResults, ...pendingResults] };
        }),
      );
      return searches;
    },
    enabled: open && mode === "bulk" && bulkSearchTerms.length > 0,
  });

  const bulkSecondParentTerms = Array.from(
    new Set(
      bulkMembers
        .filter(
          (member) =>
            member.role === "parent" &&
            !member.selectedSecondParent &&
            (member.secondParentSearch || "").trim().length >= 2,
        )
        .map((member) => (member.secondParentSearch || "").trim()),
    ),
  );
  const { data: bulkSecondParentResults = [] } = useQuery({
    queryKey: ["bulk-second-parent-search", bulkSecondParentTerms, clubId],
    queryFn: async () =>
      Promise.all(
        bulkSecondParentTerms.map(async (term) => {
          const { data } = await supabase.rpc("search_invitable_profiles", {
            _query: term,
            _limit: 5,
            _club_id: clubId ?? null,
          });
          return {
            term,
            results: ((data || []) as SearchProfile[]).map((result) => ({
              id: result.id,
              display_name: result.display_name,
              avatar_url: result.avatar_url,
            })),
          };
        }),
      ),
    enabled: open && mode === "bulk" && bulkSecondParentTerms.length > 0,
  });

  const { data: secondParentSearchResults = [] } = useQuery({
    queryKey: ["second-parent-search", debouncedSecondParentSearch, clubId],
    queryFn: async () => {
      if (debouncedSecondParentSearch.length < 2) return [];
      const { data } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedSecondParentSearch,
        _limit: 5,
        _club_id: clubId ?? null,
      });
      return ((data || []) as SearchProfile[]).map((result) => ({
        id: result.id,
        display_name: result.display_name,
        avatar_url: result.avatar_url,
      }));
    },
    enabled: debouncedSecondParentSearch.length >= 2 && !selectedSecondParent,
  });

  return {
    filteredResults: searchResults,
    filteredPendingResults,
    identityMap,
    isSearching,
    bulkSearchMap: new Map(
      bulkSearchResults.map((entry) => [entry.term, entry.results]),
    ),
    bulkSecondParentMap: new Map(
      bulkSecondParentResults.map((entry) => [entry.term, entry.results]),
    ),
    filteredSecondParentResults: secondParentSearchResults.filter(
      (result) => result.id !== selectedUser?.id,
    ),
  };
}
