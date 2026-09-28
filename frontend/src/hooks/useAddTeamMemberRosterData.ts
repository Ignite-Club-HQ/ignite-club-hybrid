import { useQuery } from "@tanstack/react-query";
import type { PendingInviteChildMatch } from "@/components/members/ChildAndSecondGuardianFields";
import { selectCachedProfilesByIds } from "@/lib/profileCache";

type ExistingTeamChildRow = {
  id: string;
  name: string;
  year_of_birth: number | null;
  parent_id: string | null;
};

type UseAddTeamMemberRosterDataArgs = {
  supabase: any;
  open: boolean;
  teamId: string;
  clubId: string;
  needsParentData: boolean;
};

export function useAddTeamMemberRosterData({
  supabase,
  open,
  teamId,
  clubId,
  needsParentData,
}: UseAddTeamMemberRosterDataArgs) {
  const { data: existingMembers } = useQuery({
    queryKey: ["team-member-ids", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", teamId);
      return data?.map((member: { user_id: string }) => member.user_id) || [];
    },
    enabled: open && !!teamId,
  });

  const { data: existingMemberNames = [] } = useQuery({
    queryKey: ["team-member-names", teamId, existingMembers],
    queryFn: async () => {
      if (!existingMembers?.length) return [];
      const { data } = await selectCachedProfilesByIds(existingMembers);
      return data || [];
    },
    enabled: open && !!teamId && (existingMembers?.length || 0) > 0,
  });

  const { data: clubBranding } = useQuery({
    queryKey: ["club-branding", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email, invite_email_style")
        .eq("id", clubId)
        .single();
      return data;
    },
    enabled: !!clubId,
  });

  const { data: clubChildren = [] } = useQuery({
    queryKey: ["club-children", clubId],
    queryFn: async () => {
      const { data: teamIds } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", clubId);

      const childIdsFromTeams = new Set<string>();
      if (teamIds?.length) {
        const { data: assignments } = await supabase
          .from("child_team_assignments")
          .select("child_id")
          .in("team_id", teamIds.map((team: { id: string }) => team.id));
        assignments?.forEach((assignment: { child_id: string }) => {
          childIdsFromTeams.add(assignment.child_id);
        });
      }

      const { data: clubParents } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId)
        .eq("role", "parent");

      const parentUserIds = [
        ...new Set<string>(clubParents?.map((parent: { user_id: string }) => parent.user_id) || []),
      ];
      const candidateChildIds = new Set<string>();
      if (parentUserIds.length) {
        const { data: parentChildren } = await supabase
          .from("children")
          .select("id")
          .in("parent_id", parentUserIds);
        parentChildren?.forEach((child: { id: string }) => candidateChildIds.add(child.id));
      }

      const toVerify = [...candidateChildIds].filter((id) => !childIdsFromTeams.has(id));
      const childIdsFromParents = new Set<string>(
        [...candidateChildIds].filter((id) => childIdsFromTeams.has(id)),
      );

      if (toVerify.length) {
        const clubTeamIds = (teamIds ?? []).map((team: { id: string }) => team.id);
        const [assignRes, pointsRes, miniLeagueRes, inviteRes] = await Promise.all([
          clubTeamIds.length
            ? supabase
                .from("child_team_assignments")
                .select("child_id")
                .in("child_id", toVerify)
                .in("team_id", clubTeamIds)
            : Promise.resolve({ data: [] as any[] }),
          supabase
            .from("child_club_points")
            .select("child_id")
            .in("child_id", toVerify)
            .eq("club_id", clubId),
          supabase
            .from("child_mini_league_assignments")
            .select("child_id, mini_leagues!inner(club_id)")
            .in("child_id", toVerify)
            .eq("mini_leagues.club_id", clubId),
          supabase
            .from("pending_invites")
            .select("metadata")
            .eq("club_id", clubId),
        ]);

        (assignRes.data as any[] | null)?.forEach((row) => childIdsFromParents.add(row.child_id));
        (pointsRes.data as any[] | null)?.forEach((row) => childIdsFromParents.add(row.child_id));
        (miniLeagueRes.data as any[] | null)?.forEach((row) => childIdsFromParents.add(row.child_id));

        const verifySet = new Set(toVerify);
        (inviteRes.data as any[] | null)?.forEach((row) => {
          const metadata = row?.metadata as any;
          const children = Array.isArray(metadata?.children) ? metadata.children : [];
          children.forEach((child: any) => {
            const reference = child?.existingChildId;
            if (typeof reference === "string" && verifySet.has(reference)) {
              childIdsFromParents.add(reference);
            }
          });
        });
      }

      const allChildIds = [...new Set([...childIdsFromTeams, ...childIdsFromParents])];
      if (!allChildIds.length) return [];

      const { data: children } = await supabase
        .from("children")
        .select("id, name, year_of_birth, parent_id")
        .in("id", allChildIds);

      if (!children?.length) return [];
      const childRows = children as ExistingTeamChildRow[];
      const parentIds = [
        ...new Set<string>(childRows.map((child) => child.parent_id).filter(Boolean) as string[]),
      ];
      const { data: parents } = await selectCachedProfilesByIds(parentIds);
      const parentMap = new Map(parents?.map((parent) => [parent.id, parent.display_name]) || []);

      return childRows.map((child) => ({
        ...child,
        parent_name: child.parent_id ? parentMap.get(child.parent_id) || "Unknown" : "Unknown",
      }));
    },
    enabled: open && !!clubId && needsParentData,
  });

  const { data: pendingInviteChildren = [] } = useQuery<PendingInviteChildMatch[]>({
    queryKey: ["pending-invite-children", teamId],
    queryFn: async () => {
      const { data: invites } = await supabase
        .from("pending_invites")
        .select("id, invited_label, metadata")
        .eq("team_id", teamId)
        .eq("status", "pending");

      if (!invites?.length) return [];

      const inviteLookup = new Map(
        invites.map((invite: { id: string }) => [invite.id, invite]),
      );
      const pendingChildren = new Map<string, PendingInviteChildMatch>();

      invites.forEach((invite: any) => {
        const metadata = invite.metadata as any;
        if (!Array.isArray(metadata?.children)) return;

        metadata.children.forEach((child: any) => {
          if (!child.name) return;
          const normalizedName = String(child.name).trim();
          const referencedInviteId =
            typeof child.existingChildId === "string" && child.existingChildId.startsWith("pending-")
              ? child.existingChildId.replace(/^pending-([^-]+)-.*$/, "$1")
              : null;
          const canonicalInviteId =
            referencedInviteId && inviteLookup.has(referencedInviteId)
              ? referencedInviteId
              : invite.id;
          const canonicalInvite = inviteLookup.get(canonicalInviteId) || invite;
          const dedupeKey = `${canonicalInviteId}:${normalizedName.toLowerCase()}:${child.yearOfBirth || ""}`;

          if (!pendingChildren.has(dedupeKey)) {
            pendingChildren.set(dedupeKey, {
              id: `pending-${canonicalInviteId}-${normalizedName}`,
              name: normalizedName,
              year_of_birth: child.yearOfBirth || null,
              parent_name: canonicalInvite.invited_label || invite.invited_label || "Unknown",
              parent_id: canonicalInviteId,
              isPending: true,
              inviteId: canonicalInviteId,
            });
          }
        });
      });

      return Array.from(pendingChildren.values());
    },
    enabled: open && !!teamId && needsParentData,
  });

  const memberNameMatchesExisting = (name: string) => {
    if (!name.trim() || name.trim().length < 3) return null;
    const query = name.trim().toLowerCase();
    return existingMemberNames.find(
      (member) => member.display_name?.toLowerCase() === query,
    ) || null;
  };

  return {
    existingMembers,
    clubBranding,
    clubChildren,
    pendingInviteChildren,
    memberNameMatchesExisting,
  };
}
