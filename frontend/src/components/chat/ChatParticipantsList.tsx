import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Loader2, ChevronRight, UserPlus, X, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
const MemberDetailSheet = lazyWithRetry(() => import("@/components/MemberDetailSheet"));
const AddGroupMembersDialog = lazyWithRetry(() => import("@/components/chat/AddGroupMembersDialog").then(m => ({ default: m.AddGroupMembersDialog })));
import AddRoleToMemberDialog from "@/components/AddRoleToMemberDialog";
import { ParticipantProfileSheet, type ParticipantRoleEntry } from "@/components/chat/ParticipantProfileSheet";
import { cn } from "@/lib/utils";
import { useOnlineSet } from "@/hooks/useUserPresence";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import {
  refreshChatManagedTeamMembership,
  refreshChatRemovedTeamMember,
} from "@/lab/teamMembershipCacheCompletion";

// Highest-privilege first. App admin sinks to the end (internal-only).
const ROLE_PRIORITY: string[] = [
  "club_admin",
  "league_admin",
  "committee_member",
  "team_admin",
  "coach",
  "parent",
  "player",
  "basic_user",
  "app_admin",
];

const ROLE_LABEL_SHORT: Record<string, string> = {
  app_admin: "App Admin",
  club_admin: "Club Admin",
  league_admin: "League Admin",
  committee_member: "Committee",
  team_admin: "Team Admin",
  coach: "Coach",
  parent: "Parent",
  player: "Player",
  basic_user: "Member",
};

function shortRoleLabel(role: string) {
  return ROLE_LABEL_SHORT[role] ?? role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}


interface ChatParticipantsListProps {
  chatType: "team" | "club" | "group" | "club_admin";
  chatId: string;
  chatName: string;
  teamId?: string;
  clubId?: string;
  miniLeagueId?: string;
  groupAllowedRoles?: string[];
  groupCreatedBy?: string | null;
  groupMembershipMode?: string | null;
  /** Club-admin thread: include this member alongside the club admins. */
  clubAdminMemberUserId?: string;
  enabled?: boolean;
  /** Called when a tap navigates away (so caller can close its sheet) */
  onBeforeNavigate?: () => void;
  className?: string;
  scrollClassName?: string;
  /** When true, render the list inline (no inner ScrollArea) so the parent container scrolls. */
  inline?: boolean;
}

interface Member {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role?: string;
}

interface SelectedMemberDetail {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  roles: { id: string; role: string }[];
}

/**
 * Reusable participants list. Extracted from ChatMembersSheet so it can be
 * embedded inside the unified Chat Details panel.
 */
export function ChatParticipantsList({
  chatType,
  chatId,
  chatName,
  teamId,
  clubId,
  miniLeagueId,
  groupAllowedRoles,
  groupCreatedBy,
  groupMembershipMode,
  clubAdminMemberUserId,
  enabled = true,
  onBeforeNavigate,
  className,
  scrollClassName = "h-[360px]",
  inline = false,
}: ChatParticipantsListProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const navigate = useNavigate();
  const previousCountRef = useRef<number | null>(null);
  const cacheKey = `chat-members-count-${chatType}-${chatId}`;

  const [selectedMember, setSelectedMember] = useState<SelectedMemberDetail | null>(null);
  const [addRoleMember, setAddRoleMember] = useState<{
    userId: string;
    userName: string;
    existingRoles: string[];
  } | null>(null);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [removeMemberConfirm, setRemoveMemberConfirm] = useState<{ id: string; name: string } | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [profileMember, setProfileMember] = useState<Member | null>(null);

  const { data: groupMeta } = useQuery({
    queryKey: ["chat-group-meta", chatId],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_groups")
        .select("created_by, membership_mode")
        .eq("id", chatId)
        .maybeSingle();
      return data ?? null;
    },
    enabled: enabled && chatType === "group" && !useIcpLab,
    staleTime: 5 * 60 * 1000,
  });

  const effectiveGroupMembershipMode = groupMembershipMode ?? groupMeta?.membership_mode ?? null;
  const groupCreatorId = groupCreatedBy ?? groupMeta?.created_by ?? null;
  // "Manual" personal-style membership: either a true personal group (no team/club)
  // or a club-scoped group created with membership_mode === 'manual' (custom category group).
  const isPersonalGroupChat =
    chatType === "group" &&
    !teamId &&
    !miniLeagueId &&
    (!clubId || effectiveGroupMembershipMode === "manual");

  const isGroupCreator = !!user && !!groupCreatorId && groupCreatorId === user.id;

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("group_members")
        .delete()
        .eq("group_id", chatId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member removed");
      queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      setRemoveMemberConfirm(null);
    },
    onError: (err: any) => {
      toast.error("Failed to remove member: " + (err?.message || "Unknown error"));
    },
  });

  const leaveGroupMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("group_members")
        .delete()
        .eq("group_id", chatId)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("You left the group");
      queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      queryClient.invalidateQueries({ queryKey: ["personal-groups"] });
      queryClient.invalidateQueries({ queryKey: ["messages-inbox"] });
      setLeaveConfirmOpen(false);
      navigate("/messages");
    },
    onError: (err: any) => {
      toast.error("Failed to leave group: " + (err?.message || "Unknown error"));
    },
  });

  const effectiveTeamId = chatType === "team" ? chatId : teamId;

  const { data: resolvedClubId } = useQuery({
    queryKey: ["chat-members-team-club", effectiveTeamId],
    queryFn: async () => {
      if (clubId) return clubId;
      if (chatType === "club") return chatId;
      if (!effectiveTeamId) return null;
      const { data } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", effectiveTeamId)
        .maybeSingle();
      return data?.club_id ?? null;
    },
    enabled: enabled && !useIcpLab && !!effectiveTeamId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: isCurrentUserAdmin } = useQuery({
    queryKey: ["chat-members-admin-check", effectiveTeamId, resolvedClubId, user?.id],
    queryFn: async () => {
      if (!user || !effectiveTeamId) return false;
      const [teamRoleResult, clubRoleResult, appAdminResult] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("team_id", effectiveTeamId)
          .in("role", ["team_admin", "coach"])
          .maybeSingle(),
        resolvedClubId
          ? supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", user.id)
              .eq("club_id", resolvedClubId)
              .eq("role", "club_admin")
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "app_admin")
          .maybeSingle(),
      ]);
      return !!teamRoleResult.data || !!clubRoleResult.data || !!appAdminResult.data;
    },
    enabled: enabled && !useIcpLab && !!user && !!effectiveTeamId && resolvedClubId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["chat-members", chatType, chatId, teamId, clubId, miniLeagueId, clubAdminMemberUserId, effectiveGroupMembershipMode],
    queryFn: async () => {
      if (useIcpLab && user?.id) {
        return [{
          id: user.id,
          display_name: "Local ICP Member",
          avatar_url: null,
          role: "club_admin",
        }] as Member[];
      }

      // Club-admin conversation: all club admins + the member
      if (chatType === "club_admin" && clubId) {
        const { data: admins } = await supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("club_id", clubId)
          .eq("role", "club_admin");
        const roleMap = new Map<string, string>();
        for (const a of admins || []) roleMap.set(a.user_id, "club_admin");
        if (clubAdminMemberUserId && !roleMap.has(clubAdminMemberUserId)) {
          roleMap.set(clubAdminMemberUserId, "member");
        }
        const userIds = Array.from(roleMap.keys());
        if (userIds.length === 0) return [] as Member[];
        const { data: profiles } = await selectCachedProfilesByIds(userIds);
        const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);
        return userIds.map((id) => {
          const p = profileMap.get(id);
          return {
            id,
            display_name: p?.display_name || null,
            avatar_url: p?.avatar_url || null,
            role: roleMap.get(id),
          } as Member;
        });
      }

      // Mini-league chat: union of league admins, per-league grants, and parents of players
      if (chatType === "group" && miniLeagueId) {
        const [leagueRow, perLeagueAdmins, players] = await Promise.all([
          supabase.from("mini_leagues").select("club_id").eq("id", miniLeagueId).maybeSingle(),
          supabase.from("mini_league_admins").select("user_id").eq("mini_league_id", miniLeagueId),
          supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", miniLeagueId)
            .not("parent_user_id", "is", null),
        ]);
        const mlClubId = leagueRow.data?.club_id;
        const roleMap = new Map<string, string>();
        if (mlClubId) {
          const { data: clubRoles } = await supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("club_id", mlClubId)
            .eq("role", "league_admin");
          for (const r of clubRoles || []) {
            roleMap.set(r.user_id, r.role);
          }
        }
        for (const a of perLeagueAdmins.data || []) {
          if (!roleMap.has(a.user_id)) roleMap.set(a.user_id, "league_admin");
        }
        for (const p of players.data || []) {
          if (p.parent_user_id && !roleMap.has(p.parent_user_id)) {
            roleMap.set(p.parent_user_id, "parent");
          }
        }
        const userIds = Array.from(roleMap.keys());
        if (userIds.length === 0) return [] as Member[];
        const { data: profiles } = await selectCachedProfilesByIds(userIds);
        const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);
        return userIds.map((id) => {
          const profile = profileMap.get(id);
          return {
            id,
            display_name: profile?.display_name || null,
            avatar_url: profile?.avatar_url || null,
            role: roleMap.get(id),
          } as Member;
        });
      }

      if (chatType === "group" && (!teamId && !clubId || effectiveGroupMembershipMode === "manual")) {
        // Use RPC so anyone with access to the group (including club admins
        // with implicit access via can_access_chat_group) can see the invited
        // participants. Club admins are only listed if they were explicitly
        // added to group_members.
        const { data: rows, error } = await supabase.rpc("get_manual_group_participants", {
          p_group_id: chatId,
        });
        if (error) return [];
        return (rows || []).map((r: any) => ({
          id: r.user_id,
          display_name: r.display_name,
          avatar_url: r.avatar_url,
          role: undefined,
        })) as Member[];
      }

      let roleQuery;
      if (chatType === "team") {
        roleQuery = supabase.from("user_roles").select("user_id, role").eq("team_id", chatId);
      } else if (chatType === "club") {
        roleQuery = supabase.from("user_roles").select("user_id, role").eq("club_id", chatId);
      } else if (chatType === "group") {
        if (teamId) {
          roleQuery = supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("team_id", teamId)
            .in(
              "role",
              (groupAllowedRoles || []) as (
                | "app_admin"
                | "basic_user"
                | "club_admin"
                | "coach"
                | "parent"
                | "player"
                | "team_admin"
              )[],
            );
        } else if (clubId) {
          roleQuery = supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("club_id", clubId)
            .in(
              "role",
              (groupAllowedRoles || []) as (
                | "app_admin"
                | "basic_user"
                | "club_admin"
                | "coach"
                | "parent"
                | "player"
                | "team_admin"
              )[],
            );
        } else {
          return [];
        }
      } else {
        return [];
      }

      const { data: roles } = await roleQuery;
      if (!roles?.length) return [];

      const userIds = [...new Set(roles.map((r) => r.user_id))] as string[];
      const { data: profiles } = await selectCachedProfilesByIds(userIds);

      const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);
      const memberMap = new Map<string, Member>();
      for (const r of roles) {
        if (!memberMap.has(r.user_id)) {
          const profile = profileMap.get(r.user_id);
          memberMap.set(r.user_id, {
            id: r.user_id,
            display_name: profile?.display_name || null,
            avatar_url: profile?.avatar_url || null,
            role: r.role,
          });
        }
      }
      return Array.from(memberMap.values());
    },
    enabled,
    staleTime: 1000 * 60 * 5,
  });

  const resolvedClubIdForBot = chatType === "club" ? chatId : clubId;
  const { data: clubBotUserId } = useQuery({
    queryKey: ["club-bot-user", chatType, chatId, resolvedClubIdForBot],
    queryFn: async () => {
      let cId = resolvedClubIdForBot;
      if (!cId && chatType === "team") {
        const { data: team } = await supabase
          .from("teams")
          .select("club_id")
          .eq("id", chatId)
          .maybeSingle();
        cId = team?.club_id ?? undefined;
      }
      if (!cId) return null;
      const { data } = await supabase.from("clubs").select("bot_user_id").eq("id", cId).maybeSingle();
      return data?.bot_user_id ?? null;
    },
    enabled,
    staleTime: 1000 * 60 * 30,
  });

  const uniqueMembers =
    members?.reduce((acc, member) => {
      if (!acc.find((m) => m.id === member.id) && member.id !== clubBotUserId) {
        acc.push(member);
      }
      return acc;
    }, [] as Member[]) || [];

  const memberIds = useMemo(() => uniqueMembers.map((m) => m.id), [uniqueMembers]);

  const { data: notifPrefs } = useQuery({
    queryKey: ["chat-members-notif-prefs", chatType, chatId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data } = await supabase.rpc("get_members_messages_enabled", { member_ids: memberIds });
      const map: Record<string, boolean> = {};
      const returnedIds = new Set<string>();
      for (const row of data || []) {
        map[row.user_id] = row.messages_enabled;
        returnedIds.add(row.user_id);
      }
      for (const id of memberIds) {
        if (!returnedIds.has(id)) map[id] = false;
      }
      return map;
    },
    enabled: enabled && !useIcpLab && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  const { data: pushReachable } = useQuery({
    queryKey: ["chat-members-push-reachable", chatType, chatId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data } = await supabase.rpc("get_members_push_reachable", { member_ids: memberIds });
      const map: Record<string, boolean> = {};
      for (const row of data || []) map[row.user_id] = row.has_push;
      return map;
    },
    enabled: enabled && !useIcpLab && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  const { data: mutePrefs } = useQuery({
    queryKey: ["chat-members-mute-prefs", chatType, chatId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data } = await supabase
        .from("chat_mute_preferences")
        .select("user_id, muted_until")
        .eq("chat_type", chatType)
        .eq("chat_id", chatId)
        .in("user_id", memberIds);
      const now = new Date();
      const map: Record<string, boolean> = {};
      for (const row of data || []) {
        const isMuted = !row.muted_until || new Date(row.muted_until) > now;
        if (isMuted) map[row.user_id] = true;
      }
      return map;
    },
    enabled: enabled && !useIcpLab && memberIds.length > 0 && chatType !== "club_admin",
    staleTime: 1000 * 60 * 2,
  });

  // Primary team name per member for the role sublabel ("Coach · U12 Boys").
  // Scope to this chat's club so we don't pull unrelated teams.
  const teamScopeClubId = resolvedClubId ?? (chatType === "club" ? chatId : clubId) ?? null;
  // All roles per member, with team_id + team name. Powers both the compact row
  // (primary role + "+N roles") and the profile sheet (grouped by team).
  const { data: memberRoleEntries } = useQuery({
    queryKey: ["chat-members-role-entries", chatType, chatId, teamScopeClubId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {} as Record<string, ParticipantRoleEntry[]>;
      let q = supabase
        .from("user_roles")
        .select("user_id, role, club_id, team_id, teams(name, club_id)")
        .in("user_id", memberIds);
      if (teamScopeClubId) {
        q = q.or(`club_id.eq.${teamScopeClubId},team_id.not.is.null`);
      }
      const { data } = await q;
      const map: Record<string, ParticipantRoleEntry[]> = {};
      const seen: Record<string, Set<string>> = {};
      for (const row of (data || []) as any[]) {
        // Filter: only keep team rows whose team belongs to our club scope (if scoped).
        if (row.team_id && teamScopeClubId && row.teams?.club_id && row.teams.club_id !== teamScopeClubId) {
          continue;
        }
        const uid = row.user_id;
        if (!map[uid]) {
          map[uid] = [];
          seen[uid] = new Set();
        }
        const dedupeKey = `${row.role}::${row.team_id ?? ""}`;
        if (seen[uid].has(dedupeKey)) continue;
        seen[uid].add(dedupeKey);
        map[uid].push({
          role: row.role,
          team_id: row.team_id ?? null,
          team_name: row.teams?.name ?? null,
        });
      }
      return map;
    },
    enabled: enabled && !useIcpLab && memberIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  // Online status: combine realtime presence with DB heartbeat (last 90s).
  const realtimeOnline = useOnlineSet(memberIds);
  const { data: heartbeatOnlineIds } = useQuery({
    queryKey: ["chat-members-online-heartbeat", chatType, chatId, memberIds],
    queryFn: async (): Promise<string[]> => {
      if (memberIds.length === 0) return [];
      const { data, error } = await supabase.rpc(
        "get_online_users_from_set" as any,
        { _user_ids: memberIds },
      );
      if (error || !data) return [];
      return (data as Array<{ user_id: string }>).map((r) => r.user_id);
    },
    enabled: enabled && !useIcpLab && memberIds.length > 0,
    staleTime: 30 * 1000,
    refetchInterval: 45 * 1000,
  });
  const onlineIds = useMemo(() => {
    const s = new Set<string>(realtimeOnline);
    for (const id of heartbeatOnlineIds || []) s.add(id);
    return s;
  }, [realtimeOnline, heartbeatOnlineIds]);

  const sortedMembers = useMemo(() => {
    return [...uniqueMembers].sort((a, b) => {
      const aOnline = onlineIds.has(a.id) ? 1 : 0;
      const bOnline = onlineIds.has(b.id) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return (a.display_name || "").localeCompare(b.display_name || "");
    });
  }, [uniqueMembers, onlineIds]);




  const handleMemberTap = async (member: Member) => {
    if (!isCurrentUserAdmin || !effectiveTeamId) return;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("id, role")
      .eq("user_id", member.id)
      .eq("team_id", effectiveTeamId);
    // Note: do NOT call onBeforeNavigate here — MemberDetailSheet is rendered
    // inside this component, so closing the parent ChatDetailsSheet would
    // unmount it before it can open.
    setSelectedMember({
      userId: member.id,
      displayName: member.display_name || "Unknown",
      avatarUrl: member.avatar_url,
      roles: (roles || []).map((r) => ({ id: r.id, role: r.role })),
    });
  };

  const handleRemoveRole = async (roleItem: { id: string; role: string }) => {
    const { error } = await supabase.from("user_roles").delete().eq("id", roleItem.id);
    if (error) {
      toast.error("Failed to remove role");
    } else {
      toast.success("Role removed");
      if (effectiveTeamId) {
        refreshChatManagedTeamMembership(queryClient, effectiveTeamId, chatType, chatId);
      } else {
        queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      }
      setSelectedMember(null);
    }
  };

  const handleRemoveMember = async () => {
    if (!selectedMember || !effectiveTeamId) return;
    // Authoritative team-member removal — same scoped RPC used by Team Detail.
    // It atomically revokes the team role, this team's child assignments and
    // team-chat group memberships. Never delete user_roles directly here.
    const { error } = await supabase.rpc("remove_team_member", {
      _team_id: effectiveTeamId,
      _user_id: selectedMember.userId,
    });
    if (error) {
      // Removal did not commit: keep the member visible and the sheet open.
      toast.error("Failed to remove member");
      return;
    }

    const refreshMembership = () => {
      refreshChatRemovedTeamMember(queryClient, effectiveTeamId, chatType, chatId);
    };

    const { error: notifyError } = await supabase.from("notifications").insert({
      user_id: selectedMember.userId,
      type: "membership",
      message: `You have been removed from ${chatName || "the team"}`,
      related_id: effectiveTeamId,
    });

    refreshMembership();
    if (notifyError) {
      // Removal committed — do not report it as a failure or retry the role.
      toast.warning("Member removed — notification failed");
    } else {
      toast.success("Member removed");
    }
    setSelectedMember(null);
  };

  useEffect(() => {
    if (!membersLoading && uniqueMembers.length > 0) {
      const storedCount = localStorage.getItem(cacheKey);
      const previousCount = storedCount ? parseInt(storedCount, 10) : null;
      if (previousCount !== null && uniqueMembers.length < previousCount) {
        queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      }
      localStorage.setItem(cacheKey, uniqueMembers.length.toString());
      previousCountRef.current = uniqueMembers.length;
    }
  }, [uniqueMembers.length, membersLoading, cacheKey, queryClient, chatType, chatId]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold">
          Participants{uniqueMembers.length > 0 ? ` · ${uniqueMembers.length}` : ""}
        </h3>
        {isPersonalGroupChat && isGroupCreator && (
          <Button variant="ghost" size="sm" className="gap-1 h-8" onClick={() => setAddPeopleOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add
          </Button>
        )}
      </div>

      {(() => {
        const listBody = membersLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : uniqueMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No participants found</p>
        ) : (
          <div className="space-y-1">
            {sortedMembers.map((member) => {
              const pushDisabled = notifPrefs ? notifPrefs[member.id] === false : false;
              const noPushSetup = pushReachable ? pushReachable[member.id] === false : false;
              const chatMuted = mutePrefs?.[member.id] ?? false;
              const canAdminTap = isCurrentUserAdmin && !!effectiveTeamId;

              // Pick the highest-priority role to show inline. In team chats,
              // prefer roles tied to this team (or club-wide), de-prioritising
              // unrelated team roles.
              const entries = memberRoleEntries?.[member.id] ?? [];
              const scored = entries.map((e) => {
                const priorityIdx = ROLE_PRIORITY.indexOf(e.role);
                const pri = priorityIdx < 0 ? 999 : priorityIdx;
                const teamRelevance =
                  chatType === "team" && effectiveTeamId
                    ? e.team_id === effectiveTeamId
                      ? 0
                      : e.team_id == null
                      ? 1
                      : 2
                    : e.team_id == null
                    ? 0
                    : 1;
                return { entry: e, pri, teamRelevance };
              });
              scored.sort((a, b) => a.teamRelevance - b.teamRelevance || a.pri - b.pri);

              const primary = scored[0]?.entry ?? (member.role
                ? ({ role: member.role, team_id: null, team_name: null } as ParticipantRoleEntry)
                : null);

              // Count unique additional roles (by role name) beyond primary
              const otherRoleNames = new Set<string>();
              for (const s of scored) {
                if (s.entry.role !== primary?.role) otherRoleNames.add(s.entry.role);
              }
              const extraCount = otherRoleNames.size;

              return (
                <div
                  key={member.id}
                  className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer active:bg-muted"
                  onClick={() => {
                    if (canAdminTap) {
                      handleMemberTap(member);
                    } else {
                      setProfileMember(member);
                    }
                  }}
                >
                  <div className="relative shrink-0">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.avatar_url || undefined} />
                      <AvatarFallback className="text-xs">
                        {member.display_name?.[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    {onlineIds.has(member.id) && (
                      <span
                        className="absolute bottom-0 right-0 block h-2 w-2 rounded-full bg-green-500 ring-2 ring-background"
                        aria-label="Online"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 leading-tight">
                    <p className="text-sm font-medium truncate">
                      {member.display_name || "Unknown"}
                    </p>
                    {primary && (
                      <p className="text-xs text-muted-foreground truncate">
                        <span className="font-medium text-foreground/70">
                          {shortRoleLabel(primary.role)}
                        </span>
                        {primary.team_name ? ` · ${primary.team_name}` : ""}
                        {extraCount > 0 ? ` · +${extraCount} role${extraCount > 1 ? "s" : ""}` : ""}
                      </p>
                    )}
                  </div>

                  {canAdminTap && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  {(pushDisabled || noPushSetup) && (
                    <svg
                      style={{ marginLeft: 4, flexShrink: 0 }}
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-label={noPushSetup ? "No push notifications set up" : "Push notifications disabled"}
                    >
                      <path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 1 .6 5" />
                      <path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" />
                      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                      <line x1="2" y1="2" x2="22" y2="22" />
                    </svg>
                  )}
                  {chatMuted && (
                    <svg
                      style={{ marginLeft: 2, flexShrink: 0 }}
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A.7.7 0 0 1 5.9 7.8H4a1 1 0 0 0-1 1v6.4a1 1 0 0 0 1 1h1.9a.7.7 0 0 1 .513.213l3.384 3.383A.705.705 0 0 0 11 19.298z" />
                      <line x1="22" y1="9" x2="16" y2="15" />
                      <line x1="16" y1="9" x2="22" y2="15" />
                    </svg>
                  )}
                  {isPersonalGroupChat && isGroupCreator && member.id !== user?.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRemoveMemberConfirm({
                          id: member.id,
                          name: member.display_name || "this member",
                        });
                      }}
                      aria-label="Remove member"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        );
        return inline ? listBody : (
          <div
            className={cn("min-h-0 overflow-y-auto overscroll-contain", scrollClassName)}
            data-allow-scroll
            data-chat-scroll-lock="true"
            style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
          >
            {listBody}
          </div>
        );
      })()}

      {isPersonalGroupChat && !!user && memberIds.includes(user.id) && (
        <div className="mt-3 px-1">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setLeaveConfirmOpen(true)}
          >
            <LogOut className="h-4 w-4" />
            Leave group
          </Button>
        </div>
      )}

      {profileMember && (
        <ParticipantProfileSheet
          open={!!profileMember}
          onOpenChange={(o) => {
            if (!o) setProfileMember(null);
          }}
          displayName={profileMember.display_name || "Unknown"}
          avatarUrl={profileMember.avatar_url}
          roles={memberRoleEntries?.[profileMember.id] ?? (profileMember.role
            ? [{ role: profileMember.role, team_id: null, team_name: null }]
            : [])}
          online={onlineIds.has(profileMember.id)}
        />
      )}

      {selectedMember && effectiveTeamId && (
        <Suspense fallback={null}>
        <MemberDetailSheet
          open={!!selectedMember}
          onOpenChange={(o) => {
            if (!o) setSelectedMember(null);
          }}
          userId={selectedMember.userId}
          displayName={selectedMember.displayName}
          avatarUrl={selectedMember.avatarUrl}
          roles={selectedMember.roles}
          canManage={true}
          canMove={false}
          isSelf={selectedMember.userId === user?.id}
          onAddRole={() => {
            setAddRoleMember({
              userId: selectedMember.userId,
              userName: selectedMember.displayName,
              existingRoles: selectedMember.roles.map((r) => r.role),
            });
          }}
          onMove={() => {}}
          onRemove={handleRemoveMember}
          onRemoveRole={handleRemoveRole}
        />
        </Suspense>
      )}

      {addRoleMember && effectiveTeamId && resolvedClubId && (
        <AddRoleToMemberDialog
          userId={addRoleMember.userId}
          userName={addRoleMember.userName}
          teamId={effectiveTeamId}
          teamName={chatName}
          clubId={resolvedClubId}
          existingRoles={addRoleMember.existingRoles}
          open={!!addRoleMember}
          onOpenChange={(o) => {
            if (!o) {
              setAddRoleMember(null);
              queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
            }
          }}
        />
      )}

      {isPersonalGroupChat && (
        <Suspense fallback={null}>
        <AddGroupMembersDialog
          open={addPeopleOpen}
          onOpenChange={setAddPeopleOpen}
          groupId={chatId}
          existingMemberIds={memberIds}
        />
        </Suspense>
      )}

      <AlertDialog
        open={!!removeMemberConfirm}
        onOpenChange={(o) => {
          if (!o) setRemoveMemberConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeMemberConfirm?.name} will no longer be able to see or post in this group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removeMemberConfirm && removeMemberMutation.mutate(removeMemberConfirm.id)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave group?</AlertDialogTitle>
            <AlertDialogDescription>
              You will no longer receive messages from this group. The group creator can add you back later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => leaveGroupMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
