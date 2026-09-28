import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InboxClub } from "@/features/messaging/inbox/inboxPreviewSources";

interface MessagesAccessClient {
  from: (table: string) => any;
}

export function useMessagesPageAccessData({
  client,
  userId,
  initialized,
  useIcpLab,
  memberClubs,
  initialAdminClubs,
}: {
  client: MessagesAccessClient;
  userId?: string;
  initialized: boolean;
  useIcpLab: boolean;
  memberClubs: readonly { id?: string }[];
  initialAdminClubs?: InboxClub[];
}) {
  const enabled = !!userId && initialized && !useIcpLab;
  const memberClubIds = useMemo(
    () => memberClubs.map((club) => club.id).filter(Boolean) as string[],
    [memberClubs],
  );

  const { data: isAppAdmin, isFetching: isAppAdminFetching } = useQuery({
    queryKey: ["is-app-admin", userId],
    queryFn: async () => {
      const { data, error } = await client
        .from("user_roles")
        .select("id")
        .eq("user_id", userId!)
        .eq("role", "app_admin")
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    enabled,
    retry: 3,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: boolean | undefined) => prev,
  });

  const { data: adminClubs } = useQuery({
    queryKey: ["admin-clubs", userId],
    queryFn: async () => {
      const { data: roles, error: rolesError } = await client
        .from("user_roles")
        .select("club_id")
        .eq("user_id", userId!)
        .eq("role", "club_admin");
      if (rolesError) throw rolesError;
      if (!roles?.length) return [];
      const clubIds = roles.map((role: { club_id?: string | null }) => role.club_id).filter(Boolean);
      const { data } = await client
        .from("clubs")
        .select("id, name, logo_url, sport")
        .in("id", clubIds)
        .is("deleted_at", null)
        .neq("kind", "shell");
      return data as InboxClub[];
    },
    enabled,
    retry: 3,
    staleTime: 5 * 60 * 1000,
    initialData: initialAdminClubs,
    placeholderData: (prev: InboxClub[] | undefined) => prev,
  });

  const { data: adminTeamIds } = useQuery({
    queryKey: ["admin-team-ids", userId],
    queryFn: async () => {
      const { data } = await client
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", userId!)
        .in("role", ["team_admin", "coach", "committee_member"]);
      return data?.map((role: { team_id?: string | null }) => role.team_id).filter(Boolean) || [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: string[] | undefined) => prev,
  });

  const { data: isCommitteeMember, isFetching: isCommitteeMemberFetching } = useQuery({
    queryKey: ["is-committee-member", userId],
    queryFn: async () => {
      const { data } = await client
        .from("user_roles")
        .select("id")
        .eq("user_id", userId!)
        .eq("role", "committee_member")
        .maybeSingle();
      return !!data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: boolean | undefined) => prev,
  });

  const { data: userAllRoles, isFetching: userAllRolesFetching } = useQuery({
    queryKey: ["user-all-roles", userId],
    queryFn: async () => {
      const { data } = await client
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", userId!);
      return data || [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const { data: userLeagueIds, isFetching: userLeagueIdsFetching } = useQuery({
    queryKey: ["user-child-league-ids", userId],
    queryFn: async () => {
      const { data: children } = await client.from("children").select("id").eq("parent_id", userId!);
      let childIds = children?.map((child: { id: string }) => child.id) || [];
      if (!childIds.length) {
        const { data: guardianLinks } = await client
          .from("child_guardians")
          .select("child_id")
          .eq("guardian_id", userId!);
        childIds = guardianLinks?.map((link: { child_id: string }) => link.child_id) || [];
      } else {
        const { data: guardianLinks } = await client
          .from("child_guardians")
          .select("child_id")
          .eq("guardian_id", userId!);
        guardianLinks?.forEach((link: { child_id: string }) => {
          if (!childIds.includes(link.child_id)) childIds.push(link.child_id);
        });
      }
      if (!childIds.length) return new Set<string>();
      const { data: assignments } = await client
        .from("child_mini_league_assignments")
        .select("mini_league_id")
        .in("child_id", childIds);
      return new Set(assignments?.map((assignment: { mini_league_id: string }) => assignment.mini_league_id) || []);
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const { data: hasAnyProAccess, isLoading: isLoadingProAccess, isFetching: isFetchingProAccess } = useQuery({
    queryKey: ["has-any-pro-access", userId],
    queryFn: async () => {
      const { data: userTeamRoles } = await client
        .from("user_roles")
        .select("team_id, club_id")
        .eq("user_id", userId!);
      if (!userTeamRoles?.length) return false;
      const teamIds = userTeamRoles.map((role: { team_id?: string | null }) => role.team_id).filter(Boolean) as string[];
      const clubIds = [...new Set(userTeamRoles.map((role: { club_id?: string | null }) => role.club_id).filter(Boolean))] as string[];
      if (teamIds.length) {
        const { data: teams } = await client.from("teams").select("club_id").in("id", teamIds);
        teams?.forEach((team: { club_id?: string | null }) => {
          if (team.club_id && !clubIds.includes(team.club_id)) clubIds.push(team.club_id);
        });
      }
      if (clubIds.length) {
        const { data: subscriptions } = await client
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
          .in("club_id", clubIds);
        if (subscriptions?.some(isActiveProSubscription)) return true;
      }
      if (teamIds.length) {
        const { data: subscriptions } = await client
          .from("team_subscriptions")
          .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
          .in("team_id", teamIds);
        if (subscriptions?.some(isActiveProSubscription)) return true;
      }
      return false;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: boolean | undefined) => prev,
  });

  const { data: clubProStatus, isLoading: isLoadingClubProStatus, isFetching: isFetchingClubProStatus } = useQuery({
    queryKey: ["club-pro-status", memberClubIds],
    queryFn: async () => {
      if (!memberClubIds.length) return {};
      const { data: subscriptions, error } = await client
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", memberClubIds);
      if (error) throw error;
      return Object.fromEntries(memberClubIds.map((id) => {
        const subscription = subscriptions?.find((entry: { club_id: string }) => entry.club_id === id);
        return [id, !!subscription && isActiveProSubscription(subscription)];
      }));
    },
    enabled: memberClubIds.length > 0 && !useIcpLab,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: Record<string, boolean> | undefined) => prev,
    retry: 2,
  });

  return {
    isAppAdmin,
    isAppAdminFetching,
    adminClubs,
    adminTeamIds,
    isCommitteeMember,
    isCommitteeMemberFetching,
    userAllRoles,
    userAllRolesFetching,
    userLeagueIds,
    userLeagueIdsFetching,
    hasAnyProAccess,
    isLoadingProAccess,
    isFetchingProAccess,
    clubProStatus,
    isLoadingClubProStatus,
    isFetchingClubProStatus,
  };
}

function isActiveProSubscription(subscription: {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
  expires_at?: string | null;
}) {
  return !!(
    (subscription.is_pro ||
      subscription.is_pro_football ||
      subscription.admin_pro_override ||
      subscription.admin_pro_football_override) &&
    (!subscription.expires_at || new Date(subscription.expires_at) > new Date())
  );
}
