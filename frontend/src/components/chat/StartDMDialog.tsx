import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { Search, MessageCircle, Loader2, Crown, Lock, Check, X, Users, SlidersHorizontal, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";


interface DMableUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  shared_clubs: string[];
  club_ids: string[];
  team_ids: string[];
  role_label: string | null;
  children_names: string[];
  has_prior_dm: boolean;
  last_seen_at: string | null;
}

interface ClubInfo {
  id: string;
  name: string;
}

interface TeamInfo {
  id: string;
  name: string;
  club_id: string;
}

const ROLE_PRIORITY: Record<string, number> = {
  club_admin: 100,
  committee_member: 90,
  team_admin: 80,
  coach: 70,
  parent: 50,
  player: 40,
  basic_user: 10,
};

const ROLE_DISPLAY: Record<string, string> = {
  club_admin: "Club Admin",
  committee_member: "Committee",
  team_admin: "Team Admin",
  coach: "Coach",
  parent: "Parent",
  player: "Player",
  basic_user: "Member",
};

function pickTopRole(roles: string[]): string | null {
  if (!roles.length) return null;
  let best: string | null = null;
  let bestScore = -1;
  for (const r of roles) {
    const s = ROLE_PRIORITY[r] ?? 0;
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return best ? (ROLE_DISPLAY[best] ?? best) : null;
}

interface StartDMDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * "dm" (default) — fast direct-message flow. Picking 1 person starts a DM
   * instantly; picking multiple auto-creates an unnamed group.
   * "custom-group" — manual people picker. Group name is required and shown at
   * the top; submit always creates a group even with one person selected.
   */
  mode?: "dm" | "custom-group";
  /**
   * custom-group mode only: when false, the category picker is hidden and the
   * group is created without a category (plain group message). Used for
   * non-admin members — subcommittee groups stay admin-only.
   */
  allowCategory?: boolean;
}

export function StartDMDialog({ open: controlledOpen, onOpenChange, mode = "dm", allowCategory = true }: StartDMDialogProps) {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<DMableUser[]>([]);
  const [groupName, setGroupName] = useState("");
  const BUILTIN_CATEGORIES = ["Club Management", "Operations", "Volunteers", "Custom Groups"] as const;
  const CUSTOM_CATS_KEY = "chat.custom_categories";
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_CATS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    } catch { return []; }
  });
  const [groupCategory, setGroupCategory] = useState<string>("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  // Custom-group progressive disclosure: step 1 = pick people, step 2 = name/configure.
  const [groupStep, setGroupStep] = useState<1 | 2>(1);
  const [selectedClubId, setSelectedClubId] = useState<string>("all");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("all");
  // Role-group filter used by the compact "Filter" chip (coaches / committee).
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [filterOpen, setFilterOpen] = useState(false);


  // Use controlled or uncontrolled state
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
    } else {
      setInternalOpen(open);
    }
  };

  // Auto-select club filter when in club mode
  useEffect(() => {
    if (activeClubFilter && isOpen) {
      setSelectedClubId(activeClubFilter);
    }
  }, [activeClubFilter, isOpen]);

  // Keep category picker collapsed unless a non-default category is already chosen.
  useEffect(() => {
    if (!isOpen) {
      setShowCategoryPicker(false);
      setGroupCategory("");
      setGroupStep(1);
    }
  }, [isOpen]);

  // Check if user has Pro access for DMs
  const { data: hasProAccess, isLoading: checkingPro } = useQuery({
    queryKey: ["has-pro-for-dm", user?.id],
    queryFn: async () => {
      // Get clubs user is a member of
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);

      if (!roles?.length) return false;

      const clubIds = [...new Set(roles.map(r => r.club_id).filter(Boolean))];

      // Check if any of these clubs have Pro
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", clubIds);

      return subs?.some(sub => 
        (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) && 
        (!sub.expires_at || new Date(sub.expires_at) > new Date())
      ) ?? false;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Check if current user can send DMs (has admin role or allowed by club settings)
  const { data: canSendDMs, isLoading: checkingCanSend } = useQuery({
    queryKey: ["can-send-dms", user?.id],
    queryFn: async () => {
      // First check if user is app_admin - they can always DM
      const { data: isAppAdmin } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      
      if (isAppAdmin) return { canSend: true, reason: null };

      // Get user's club memberships with their roles
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select("club_id, team_id, role")
        .eq("user_id", user!.id);

      if (!userRoles?.length) return { canSend: false, reason: "no_membership" };

      // Get unique club IDs from direct club roles
      const directClubIds = userRoles.filter(r => r.club_id).map(r => r.club_id);
      
      // Also get club IDs from team memberships
      const teamIds = userRoles.filter(r => r.team_id).map(r => r.team_id);
      let teamClubIds: string[] = [];
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("id, club_id")
          .in("id", teamIds);
        teamClubIds = (teams || []).map(t => t.club_id);
      }

      const allClubIds = [...new Set([...directClubIds, ...teamClubIds].filter(Boolean))] as string[];
      if (allClubIds.length === 0) return { canSend: false, reason: "no_membership" };

      // Check Pro status of these clubs
      const { data: proClubs } = await supabase
        .from("club_subscriptions")
        .select("club_id")
        .in("club_id", allClubIds)
        .or("is_pro.eq.true,is_pro_football.eq.true,admin_pro_override.eq.true,admin_pro_football_override.eq.true");

      const proClubIds = proClubs?.map(c => c.club_id) || [];
      if (proClubIds.length === 0) return { canSend: false, reason: "no_pro" };

      // Get DM settings for Pro clubs
      const { data: dmSettings } = await supabase
        .from("club_dm_settings")
        .select("club_id, dm_enabled, allowed_roles")
        .in("club_id", proClubIds);

      // Check if user has permission in any Pro club
      for (const clubId of proClubIds) {
        const settings = dmSettings?.find(s => s.club_id === clubId);
        const dmEnabled = settings?.dm_enabled ?? true;
        const allowedRoles = settings?.allowed_roles ?? ['app_admin', 'club_admin', 'team_admin'];

        if (!dmEnabled) continue;

        // Check if user has an allowed role in this club
        const userClubRoles = userRoles.filter(r => r.club_id === clubId).map(r => r.role);
        if (userClubRoles.some(role => allowedRoles.includes(role))) {
          return { canSend: true, reason: null };
        }

        // Check if user has an allowed role in any team of this club
        const clubTeamIds = teamIds.filter(tid => {
          const teamRole = userRoles.find(r => r.team_id === tid);
          if (!teamRole) return false;
          // Check if this team belongs to the club
          return teamClubIds.includes(clubId);
        });
        
        const userTeamRoles = userRoles
          .filter(r => clubTeamIds.includes(r.team_id as string))
          .map(r => r.role);
        
        if (userTeamRoles.some(role => allowedRoles.includes(role))) {
          return { canSend: true, reason: null };
        }
      }

      return { canSend: false, reason: "not_admin" };
    },
    enabled: !!user && hasProAccess === true,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch users that can be DMed (members of shared Pro clubs + mini-league parents) excluding app admins
  const { data: dmData, isLoading: loadingUsers } = useQuery({
    queryKey: ["dmable-users-with-filters", user?.id, activeClubFilter],
    queryFn: async () => {
      // Get Pro clubs user is a member of
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);

      if (!userRoles?.length) return { users: [], clubs: [], teams: [] };

      let clubIds = [...new Set(userRoles.map(r => r.club_id).filter(Boolean))] as string[];

      // If in club mode, filter to only the active club
      if (activeClubFilter) {
        clubIds = clubIds.filter(id => id === activeClubFilter);
      }

      if (clubIds.length === 0) return { users: [], clubs: [], teams: [] };

      // Filter to Pro clubs only
      const { data: proClubs } = await supabase
        .from("club_subscriptions")
        .select("club_id")
        .in("club_id", clubIds)
        .or("is_pro.eq.true,is_pro_football.eq.true,admin_pro_override.eq.true,admin_pro_football_override.eq.true");

      const proClubIds = proClubs?.map(c => c.club_id) || [];
      if (proClubIds.length === 0) return { users: [], clubs: [], teams: [] };

      // Fetch clubs, teams, club members, mini-leagues, and app admins in parallel
      const [clubsResult, teamsResult, clubMembersResult, miniLeaguesResult, appAdminsResult] = await Promise.all([
        supabase.from("clubs").select("id, name").in("id", proClubIds),
        supabase.from("teams").select("id, name, club_id").in("club_id", proClubIds),
        supabase.from("user_roles").select("user_id, club_id, team_id, role").in("club_id", proClubIds).neq("user_id", user!.id),
        supabase.from("mini_leagues").select("id, club_id").in("club_id", proClubIds),
        supabase.from("user_roles").select("user_id").eq("role", "app_admin"),
      ]);

      const clubs = (clubsResult.data || []) as ClubInfo[];
      const teams = (teamsResult.data || []) as TeamInfo[];
      const clubMembers = clubMembersResult.data || [];
      const miniLeagues = miniLeaguesResult.data || [];
      const appAdminIds = new Set((appAdminsResult.data || []).map(a => a.user_id));

      const clubNameMap = new Map(clubs.map(c => [c.id, c.name]));

      // Get mini-league parents
      let miniLeagueParents: { parent_user_id: string; mini_league_id: string }[] = [];
      if (miniLeagues.length > 0) {
        const miniLeagueIds = miniLeagues.map(ml => ml.id);
        const { data: mlPlayers } = await supabase
          .from("mini_league_players")
          .select("parent_user_id, mini_league_id")
          .in("mini_league_id", miniLeagueIds)
          .not("parent_user_id", "is", null);
        miniLeagueParents = (mlPlayers || []).filter(p => p.parent_user_id !== user!.id);
      }

      // Build a map of mini-league to club
      const miniLeagueClubMap = new Map(miniLeagues.map(ml => [ml.id, ml.club_id]));

      // Group by user and collect their clubs, teams, and roles
      const userClubMap = new Map<string, Set<string>>();
      const userTeamMap = new Map<string, Set<string>>();
      const userClubNameMap = new Map<string, string[]>();
      const userRoleMap = new Map<string, Set<string>>();
      
      // Process club members (excluding app_admin role users)
      clubMembers.forEach((member: { user_id: string; club_id: string; team_id: string | null; role: string }) => {
        // Skip app admins
        if (appAdminIds.has(member.user_id)) return;

        if (!userClubMap.has(member.user_id)) {
          userClubMap.set(member.user_id, new Set());
          userTeamMap.set(member.user_id, new Set());
          userClubNameMap.set(member.user_id, []);
          userRoleMap.set(member.user_id, new Set());
        }
        if (member.club_id) {
          userClubMap.get(member.user_id)!.add(member.club_id);
          const clubName = clubNameMap.get(member.club_id);
          if (clubName && !userClubNameMap.get(member.user_id)!.includes(clubName)) {
            userClubNameMap.get(member.user_id)!.push(clubName);
          }
        }
        if (member.team_id) {
          userTeamMap.get(member.user_id)!.add(member.team_id);
        }
        if (member.role) userRoleMap.get(member.user_id)!.add(member.role);
      });

      // Process mini-league parents (they might not have user_roles entries)
      miniLeagueParents.forEach((mlParent) => {
        // Skip app admins
        if (appAdminIds.has(mlParent.parent_user_id)) return;

        const clubId = miniLeagueClubMap.get(mlParent.mini_league_id);
        if (!clubId) return;

        if (!userClubMap.has(mlParent.parent_user_id)) {
          userClubMap.set(mlParent.parent_user_id, new Set());
          userTeamMap.set(mlParent.parent_user_id, new Set());
          userClubNameMap.set(mlParent.parent_user_id, []);
          userRoleMap.set(mlParent.parent_user_id, new Set());
        }
        userClubMap.get(mlParent.parent_user_id)!.add(clubId);
        userRoleMap.get(mlParent.parent_user_id)!.add("parent");
        const clubName = clubNameMap.get(clubId);
        if (clubName && !userClubNameMap.get(mlParent.parent_user_id)!.includes(clubName)) {
          userClubNameMap.get(mlParent.parent_user_id)!.push(clubName);
        }
      });

      const uniqueUserIds = [...userClubMap.keys()];

      if (uniqueUserIds.length === 0) return { users: [], clubs, teams };

      // Fetch profiles, children (parent's kids), and prior DM partners in parallel
      const [profilesResult, childrenResult, dmResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, avatar_url, last_seen_at")
          .in("id", uniqueUserIds),
        supabase
          .from("children")
          .select("name, parent_id")
          .in("parent_id", uniqueUserIds),
        supabase
          .from("direct_conversations")
          .select("participant_1, participant_2")
          .or(`participant_1.eq.${user!.id},participant_2.eq.${user!.id}`),
      ]);

      const profiles = profilesResult.data || [];
      const childRows = (childrenResult.data || []) as { name: string; parent_id: string }[];
      const dmRows = (dmResult.data || []) as { participant_1: string; participant_2: string }[];

      const childrenByParent = new Map<string, string[]>();
      childRows.forEach(c => {
        if (!c.parent_id || !c.name) return;
        const list = childrenByParent.get(c.parent_id) || [];
        list.push(c.name);
        childrenByParent.set(c.parent_id, list);
      });

      const priorDMPartners = new Set<string>();
      dmRows.forEach(d => {
        const other = d.participant_1 === user!.id ? d.participant_2 : d.participant_1;
        if (other) priorDMPartners.add(other);
      });

      const users = profiles.map(p => ({
        ...p,
        shared_clubs: userClubNameMap.get(p.id) || [],
        club_ids: [...(userClubMap.get(p.id) || [])],
        team_ids: [...(userTeamMap.get(p.id) || [])],
        role_label: pickTopRole([...(userRoleMap.get(p.id) || [])]),
        children_names: childrenByParent.get(p.id) || [],
        has_prior_dm: priorDMPartners.has(p.id),
        last_seen_at: (p as { last_seen_at?: string | null }).last_seen_at ?? null,
      })) as DMableUser[];

      return { users, clubs, teams };
    },
    enabled: !!user && hasProAccess === true,
    staleTime: 2 * 60 * 1000,
  });

  const dmableUsers = dmData?.users || [];
  const availableClubs = dmData?.clubs || [];
  const availableTeams = dmData?.teams || [];

  // Filter teams based on selected club, then sort them in a predictable order:
  // age-group teams (U6, U7 Blue, U8...) ascending first, then any other team
  // names alphabetically.
  const filteredTeams = useMemo(() => {
    const scoped = selectedClubId === "all"
      ? availableTeams
      : availableTeams.filter(t => t.club_id === selectedClubId);
    const ageOf = (name: string) => {
      const m = /^u\s*(\d{1,2})\b/i.exec((name || "").trim());
      return m ? parseInt(m[1], 10) : null;
    };
    return [...scoped].sort((a, b) => {
      const aa = ageOf(a.name);
      const ba = ageOf(b.name);
      if (aa !== null && ba !== null && aa !== ba) return aa - ba;
      if (aa !== null && ba === null) return -1;
      if (aa === null && ba !== null) return 1;
      return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
    });
  }, [availableTeams, selectedClubId]);


  // Start single DM mutation
  const startDMMutation = useMutation({
    mutationFn: async (otherUserId: string) => {
      const { data, error } = await supabase.rpc("get_or_create_dm_conversation", {
        other_user_id: otherUserId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (conversationId) => {
      setOpen(false);
      setSelectedUsers([]);
      navigate(`/messages/dm/${conversationId}`);
    },
    onError: (error) => {
      toast.error("Failed to start conversation: " + error.message);
    },
  });

  // Start group DM mutation (creates a chat group)
  const startGroupDMMutation = useMutation({
    mutationFn: async ({ users, customName, category }: { users: DMableUser[]; customName: string; category?: string | null }) => {
      // Use custom name if provided, otherwise auto-name from member first names
      const groupName = customName.trim() || users.map(u => u.display_name?.split(" ")[0] || "User").join(", ");
      
      const allowedRoles: ("basic_user" | "club_admin" | "team_admin" | "coach" | "player" | "parent" | "app_admin")[] = 
        ["basic_user", "parent", "player", "coach", "team_admin", "club_admin"];
      
      // Category-only club scope: when a category is chosen and a real club is
      // selected (not "all"), stamp the group with club_id so the folder trigger
      // fires. Use manual membership
      // mode + empty allowed_roles so `can_access_chat_group` does NOT expose
      // the group to every member of the club — only explicit invitees + the
      // creator (added by DB trigger) can see it.
      const hasCategory = !!(category && category.trim());
      const scopedClubId = selectedClubId && selectedClubId !== "all" ? selectedClubId : null;
      const categoryOnlyClubScope = hasCategory && !!scopedClubId;

      const insertPayload: Record<string, unknown> = {
        name: groupName,
        created_by: user!.id,
        allowed_roles: categoryOnlyClubScope ? [] : allowedRoles,
      };
      if (hasCategory) insertPayload.category = category!.trim();
      if (categoryOnlyClubScope) {
        insertPayload.club_id = scopedClubId;
        insertPayload.membership_mode = "manual";
      }

      const { data: groupData, error: groupError } = await supabase
        .from("chat_groups")
        .insert(insertPayload as any)
        .select()
        .single();
      
      if (groupError) throw groupError;
      
      // Add explicit members. Category-scoped club groups are manual + invite-only,
      // and because they have club_id set the personal-group DB trigger does not
      // auto-add the creator. Include the creator so the group starts with exactly
      // one member unless others were selected.
      const memberInserts = [
        ...(categoryOnlyClubScope ? [{ id: user!.id }] : []),
        ...users,
      ].map(u => ({
        group_id: groupData.id,
        user_id: u.id,
        added_by: user!.id,
      }));

      if (memberInserts.length > 0) {
        const { error: membersError } = await supabase
          .from("group_members")
          .insert(memberInserts);

        if (membersError) {
          console.error("Failed to add members, rolling back group:", membersError);
          // Best-effort cleanup so we don't leave an orphan group behind.
          await supabase.from("chat_groups").delete().eq("id", groupData.id);
          throw new Error("Could not add members to the group. Please try again.");
        }
      }

      return groupData.id as string;
    },
    onSuccess: (groupId) => {
      setOpen(false);
      setSelectedUsers([]);
      setGroupName("");
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      navigate(`/groups/${groupId}`);
      toast.success("Group chat created!");
    },
    onError: (error) => {
      toast.error("Failed to create group chat: " + error.message);
    },
  });

  const toggleUserSelection = (dmUser: DMableUser) => {
    setSelectedUsers(prev => {
      const isSelected = prev.some(u => u.id === dmUser.id);
      // Direct messages are strictly one-to-one: picking someone replaces the
      // current selection. Group chats keep multi-select.
      if (mode !== "custom-group") {
        return isSelected ? [] : [dmUser];
      }
      if (isSelected) {
        return prev.filter(u => u.id !== dmUser.id);
      } else {
        return [...prev, dmUser];
      }
    });
  };


  const removeSelectedUser = (userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
  };

  const handleStartConversation = () => {
    if (mode === "custom-group") {
      if (!groupName.trim()) {
        toast.error("Give your group a name");
        return;
      }
      const category = allowCategory && groupCategory.trim() ? groupCategory.trim() : null;
      startGroupDMMutation.mutate({ users: selectedUsers, customName: groupName, category });
      return;
    }

    if (selectedUsers.length === 0) return;

    // DM mode is single-recipient only.
    startDMMutation.mutate(selectedUsers[0].id);

  };

  // Filter users by search query, club, and team
  const filteredUsers = useMemo(() => {
    if (!dmableUsers) return [];
    
    let filtered = dmableUsers;
    
    // Filter by club
    if (selectedClubId !== "all") {
      filtered = filtered.filter(u => u.club_ids.includes(selectedClubId));
    }
    
    // Filter by team
    if (selectedTeamId !== "all") {
      filtered = filtered.filter(u => u.team_ids.includes(selectedTeamId));
    }

    // Filter by role group (coaches / committee & admins)
    if (roleFilter !== "all") {
      filtered = filtered.filter(u => {
        const label = (u.role_label || "").toLowerCase();
        if (roleFilter === "coach") return label === "coach";
        if (roleFilter === "committee") return label === "committee" || label.includes("admin");
        if (roleFilter === "parent") return label === "parent";
        if (roleFilter === "player") return label === "player";
        return true;
      });
    }


    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(u => 
        u.display_name?.toLowerCase().includes(query) ||
        u.shared_clubs.some(c => c.toLowerCase().includes(query))
      );
    }

    // Sort: prior DM partners first, then most recently active, then by name
    const sorted = [...filtered].sort((a, b) => {
      if (a.has_prior_dm !== b.has_prior_dm) return a.has_prior_dm ? -1 : 1;
      const aSeen = a.last_seen_at ? Date.parse(a.last_seen_at) : 0;
      const bSeen = b.last_seen_at ? Date.parse(b.last_seen_at) : 0;
      if (aSeen !== bSeen) return bSeen - aSeen;
      return (a.display_name || "").localeCompare(b.display_name || "");
    });

    return sorted;
  }, [dmableUsers, searchQuery, selectedClubId, selectedTeamId, roleFilter]);

  // Detect display-name collisions within the current visible result set so we
  // can append a privacy-friendly disambiguator (#abcd from user id) only when
  // two or more visible rows share the exact name.
  const collidingNames = useMemo(() => {
    const counts = new Map<string, number>();
    filteredUsers.forEach(u => {
      const key = (u.display_name || "").trim().toLowerCase();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const set = new Set<string>();
    counts.forEach((n, k) => { if (n > 1) set.add(k); });
    return set;
  }, [filteredUsers]);

  // Quick lookup for team names by id (used to show actual team name when a
  // user belongs to exactly one team shared with the picker scope).
  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    availableTeams.forEach(t => m.set(t.id, t.name));
    return m;
  }, [availableTeams]);

  const isPending = startDMMutation.isPending || startGroupDMMutation.isPending;

  // Reset team filter when club changes
  const handleClubChange = (value: string) => {
    setSelectedClubId(value);
    setSelectedTeamId("all");
  };

  // Check if club filter is locked (in club mode)
  const isClubFilterLocked = !!activeClubFilter;
  const keyboardHeight = useNativeKeyboardHeight();
  const isKeyboardOpen = useKeyboardOpen();
  const isCustomGroup = mode === "custom-group";
  const showClubFilter = !isClubFilterLocked && availableClubs.length > 1;
  const CREATE_CATEGORY_VALUE = "__create_new__";
  const selectedPrimaryName = selectedUsers[0]?.display_name?.trim() || "selected member";
  const dmActionLabel = `Message ${selectedPrimaryName.split(" ")[0] || selectedPrimaryName}`;

  const canPickPeople = !!hasProAccess && !!canSendDMs?.canSend;
  const activeFilterLabel =
    selectedTeamId !== "all"
      ? teamNameById.get(selectedTeamId) ?? "Team"
      : roleFilter === "coach"
        ? "Coaches"
        : roleFilter === "committee"
          ? "Committee"
          : roleFilter === "parent"
            ? "Parents"
            : roleFilter === "player"
              ? "Players"
              : "Everyone";
  const filterActive = selectedTeamId !== "all" || roleFilter !== "all";

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={(open) => {
      setOpen(open);
      if (!open) {
        setSelectedUsers([]);
        setGroupName("");
        setSearchQuery("");
        setSelectedClubId(activeClubFilter || "all");
        setSelectedTeamId("all");
        setRoleFilter("all");
        setFilterOpen(false);
      }
    }}>
      <ResponsiveDialogContent className="sm:max-w-md" fullScreen>
        <ResponsiveDialogHeader className="text-left sm:text-left space-y-1">
          <ResponsiveDialogTitle className="flex items-center gap-2">
            {mode === "custom-group"
              ? groupStep === 1 ? "New Group Message" : "Name your group"
              : "New Message"}
            {!hasProAccess && (
              <Badge variant="secondary" className="gap-1">
                <Crown className="h-3 w-3" />
                Pro
              </Badge>
            )}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-sm text-left">
            {mode === "custom-group"
              ? groupStep === 1
                ? "Choose who's in the group"
                : `${selectedUsers.length} ${selectedUsers.length === 1 ? "member" : "members"} selected`
              : "Select one person"}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>


        {/* Compact sticky search + filter toolbar: stays under the header while
            the member list scrolls independently beneath it. */}
        {canPickPeople && !(isCustomGroup && groupStep === 2) && (
          <div className="shrink-0 flex items-center gap-2 pt-2 pb-2 px-1 bg-background border-b border-border">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search people..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 rounded-xl pl-9 pr-8"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant={filterActive ? "secondary" : "outline"}
                  className="h-10 shrink-0 rounded-xl gap-1.5 px-3 text-xs font-medium max-w-[9.5rem]"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{activeFilterLabel}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="z-[1000020] w-56 p-1">
                <div className="max-h-[60vh] overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTeamId("all");
                      setRoleFilter("all");
                      setFilterOpen(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="truncate">Everyone</span>
                    {!filterActive && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                  <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Roles
                  </p>
                  {[
                    { key: "role:coach", label: "Coaches" },
                    { key: "role:committee", label: "Committee & admins" },
                    { key: "role:parent", label: "Parents" },
                    { key: "role:player", label: "Players" },
                  ].map((opt) => {
                    const selected = selectedTeamId === "all" && `role:${roleFilter}` === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => {
                          setSelectedTeamId("all");
                          setRoleFilter(opt.key.split(":")[1]);
                          setFilterOpen(false);
                        }}
                        className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">{opt.label}</span>
                        {selected && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    );
                  })}

                  {filteredTeams.length > 0 && (
                    <>
                      <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Teams
                      </p>
                      {filteredTeams.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => {
                            setRoleFilter("all");
                            setSelectedTeamId(team.id);
                            setFilterOpen(false);
                          }}
                          className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
                        >
                          <span className="truncate">{team.name}</span>
                          {selectedTeamId === team.id && (
                            <Check className="h-4 w-4 text-primary shrink-0" />
                          )}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}

        <div
          className="flex-1 min-h-0 overflow-y-auto space-y-3 pt-3 px-1 pb-4"
          style={
            isKeyboardOpen && !(selectedUsers.length > 0 || isCustomGroup)
              ? { paddingBottom: `${keyboardHeight + 16}px` }
              : undefined
          }
        >

          {(checkingPro && hasProAccess === undefined) || (checkingCanSend && canSendDMs === undefined) ? (
            <div className="flex justify-center py-8 flex-1 items-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !hasProAccess ? (
            <div className="flex flex-col items-center py-8 text-center gap-3 flex-1 justify-center">
              <div className="p-3 rounded-full bg-muted">
                <Lock className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">Pro Feature</p>
                <p className="text-sm text-muted-foreground">
                  Direct messages require you to be a member of a Pro club
                </p>
              </div>
            </div>
          ) : !canSendDMs?.canSend ? (
            <div className="flex flex-col items-center py-8 text-center gap-3 flex-1 justify-center">
              <div className="p-3 rounded-full bg-muted">
                <Lock className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">Admin Feature</p>
                <p className="text-sm text-muted-foreground">
                  Direct messages are restricted to club administrators. Contact your club admin if you need this feature enabled.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Selected count + chips header (step 1 of group flow) */}
              {isCustomGroup && groupStep === 1 && (
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {selectedUsers.length === 0
                      ? "0 members selected"
                      : `${selectedUsers.length} ${selectedUsers.length === 1 ? "member" : "members"} selected`}
                  </p>
                  {selectedUsers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedUsers([])}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
              {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-0.5">
                  {selectedUsers.map(u => (
                    <Badge key={u.id} variant="secondary" className="gap-1 pr-1 rounded-full">
                      {u.display_name?.split(" ")[0] || "User"}
                      <button
                        onClick={() => removeSelectedUser(u.id)}
                        className="ml-0.5 rounded-full hover:bg-background/60 p-0.5"
                        aria-label="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}


              {/* Group name: required + always shown in custom-group mode; optional + shown when 2+ in DM mode */}
              {isCustomGroup && groupStep === 2 && (
                <div className="space-y-2">
                  <Input
                    placeholder={isCustomGroup ? "Group name" : "Group name (optional)"}
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    onFocus={(e) => {
                      const el = e.currentTarget;
                      setTimeout(() => {
                        try {
                          el.scrollIntoView({ block: "center", behavior: "smooth" });
                        } catch {}
                      }, 300);
                    }}
                    maxLength={60}
                    autoComplete="off"
                    className="h-11 rounded-xl"
                  />
                  {isCustomGroup && allowCategory && (() => {
                    const allCategories = Array.from(new Set([...BUILTIN_CATEGORIES, ...customCategories]));
                    const handleCategoryChange = (value: string) => {
                      if (value === CREATE_CATEGORY_VALUE) {
                        const input = window.prompt("New category name");
                        const trimmed = (input || "").trim().slice(0, 40);
                        if (!trimmed) return;
                        const existing = allCategories.find((c) => c.toLowerCase() === trimmed.toLowerCase());
                        if (existing) {
                          setGroupCategory(existing);
                          return;
                        }
                        const next = [...customCategories, trimmed];
                        setCustomCategories(next);
                        try { localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(next)); } catch {}
                        setGroupCategory(trimmed);
                        return;
                      }
                      setGroupCategory(value);
                    };
                    if (!showCategoryPicker && !groupCategory) {
                      return (
                        <button
                          type="button"
                          onClick={() => setShowCategoryPicker(true)}
                          className="text-xs text-muted-foreground hover:text-foreground underline decoration-muted-foreground/40 underline-offset-2 text-left"
                        >
                          Make this a subcommittee group
                        </button>
                      );
                    }
                    return (
                      <div className="flex items-center gap-2">
                        <Select value={groupCategory} onValueChange={handleCategoryChange}>
                          <SelectTrigger className="h-9 rounded-xl text-xs flex-1">
                            <SelectValue placeholder="Category" />
                          </SelectTrigger>
                          <SelectContent className="z-[1000020]">
                            {allCategories.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                            <SelectItem value={CREATE_CATEGORY_VALUE} className="text-primary">
                              + Create new category…
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          onClick={() => {
                            setGroupCategory("");
                            setShowCategoryPicker(false);
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })()}
                  {!isCustomGroup && (
                    <p className="text-xs text-muted-foreground">Leave blank to use member names</p>
                  )}
                </div>
              )}

              {/* Club picker only when the user really belongs to several clubs */}
              {showClubFilter && !(isCustomGroup && groupStep === 2) && (
                <Select value={selectedClubId} onValueChange={handleClubChange}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder="All Clubs" />
                  </SelectTrigger>
                  <SelectContent className="z-[1000020]">
                    <SelectItem value="all">All Clubs</SelectItem>
                    {availableClubs.map(club => (
                      <SelectItem key={club.id} value={club.id}>{club.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}


              {!(isCustomGroup && groupStep === 2) && (
              <div>
                <div className="space-y-1">
                  {loadingUsers && filteredUsers.length === 0 ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredUsers.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      {searchQuery || selectedClubId !== "all" || selectedTeamId !== "all" 
                        ? "No members found" 
                        : "No members available to message"}
                    </div>
                  ) : (
                    filteredUsers.map((dmUser) => {
                      const isSelected = selectedUsers.some(u => u.id === dmUser.id);
                      const teamCount = dmUser.team_ids.length;
                      const initials = (dmUser.display_name || "?")
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map(s => s.charAt(0).toUpperCase())
                        .join("");

                      // Show actual team name when the user is in exactly one team
                      // within the current picker scope; otherwise show the count.
                      const scopedTeamIds = selectedClubId === "all"
                        ? dmUser.team_ids
                        : dmUser.team_ids.filter(tid => {
                            const t = teamNameById.get(tid);
                            return !!t;
                          });
                      const singleTeamName = scopedTeamIds.length === 1
                        ? teamNameById.get(scopedTeamIds[0]) ?? null
                        : null;

                      // Privacy-friendly collision disambiguator: 4 hex chars
                      // from the user id, only shown when the visible list
                      // contains another row with the same display name.
                      const nameKey = (dmUser.display_name || "").trim().toLowerCase();
                      const showIdSuffix = nameKey && collidingNames.has(nameKey);
                      const idSuffix = showIdSuffix ? `#${dmUser.id.replace(/-/g, "").slice(0, 4)}` : null;

                      // Secondary line: role · parent of kid names
                      const secondaryParts: string[] = [];
                      if (dmUser.role_label) secondaryParts.push(dmUser.role_label);
                      if (dmUser.children_names.length > 0) {
                        const kids = dmUser.children_names.slice(0, 3).join(", ");
                        const more = dmUser.children_names.length > 3 ? ` +${dmUser.children_names.length - 3}` : "";
                        secondaryParts.push(`Parent of ${kids}${more}`);
                      }
                      const secondaryLine = secondaryParts.join(" · ");

                      return (
                        <button
                          key={dmUser.id}
                          onClick={() => toggleUserSelection(dmUser)}
                          disabled={isPending}
                          aria-pressed={isSelected}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left touch-manipulation border ${
                            isSelected
                              ? "bg-primary/10 border-primary/40"
                              : "bg-transparent border-transparent hover:bg-accent/40"
                          }`}
                        >
                          <Avatar className="h-10 w-10 shrink-0">
                            <AvatarImage src={dmUser.avatar_url || undefined} />
                            <AvatarFallback className="text-xs font-semibold bg-muted">
                              {initials || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate text-sm leading-tight flex items-center gap-1.5">
                              <span className="truncate">{dmUser.display_name || "Unknown User"}</span>
                              {idSuffix && (
                                <span className="text-[10px] font-mono font-normal text-muted-foreground shrink-0">
                                  {idSuffix}
                                </span>
                              )}
                              {dmUser.has_prior_dm && (
                                <History
                                  className="h-3 w-3 shrink-0 text-muted-foreground/60"
                                  aria-label="You've messaged before"
                                />
                              )}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                              {secondaryLine && (
                                <span className="text-[11px] text-muted-foreground truncate">
                                  {secondaryLine}
                                </span>
                              )}
                              {singleTeamName ? (
                                <span className="inline-flex items-center gap-1 shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary max-w-[140px]">
                                  <Users className="h-2.5 w-2.5 shrink-0" />
                                  <span className="truncate">{singleTeamName}</span>
                                </span>
                              ) : teamCount > 0 ? (
                                <span className="inline-flex items-center gap-1 shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                                  <Users className="h-2.5 w-2.5" />
                                  {teamCount} teams
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <span
                            aria-hidden
                            className={`h-6 w-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                              isSelected
                                ? "bg-primary border-primary"
                                : "border-muted-foreground/30"
                            }`}
                          >
                            <Check
                              className={`h-3.5 w-3.5 text-primary-foreground transition-opacity ${
                                isSelected ? "opacity-100" : "opacity-0"
                              }`}
                              strokeWidth={3}
                            />
                          </span>
                        </button>
                      );

                    })
                  )}
                </div>
              </div>
              )}
            </>
          )}
        </div>

        {/* Anchored footer — sits above the keyboard via dynamic inset, never floats over the list */}
        {(selectedUsers.length > 0 || isCustomGroup) && (
          <div
            className="shrink-0 border-t border-border bg-card px-4 pt-3 shadow-[0_-4px_12px_-8px_hsl(var(--foreground)/0.2)]"
            style={{
              paddingBottom: isKeyboardOpen
                ? `${keyboardHeight + 12}px`
                : `calc(env(safe-area-inset-bottom, 0px) + 0.75rem)`,
            }}
          >
            {isCustomGroup ? (
              groupStep === 1 ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setOpen(false)}
                    className="text-muted-foreground hover:text-foreground px-4"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => setGroupStep(2)}
                    className="flex-1 h-11 rounded-xl font-semibold gap-2"
                  >
                    Next
                    {selectedUsers.length > 0 && ` · ${selectedUsers.length}`}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setGroupStep(1)}
                      className="text-muted-foreground hover:text-foreground px-4"
                    >
                      Back
                    </Button>
                    <Button
                      onClick={handleStartConversation}
                      disabled={isPending || !groupName.trim()}
                      className="flex-1 h-11 rounded-xl font-semibold gap-2"
                    >
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Users className="h-4 w-4" />
                      )}
                      Create Group
                    </Button>
                  </div>
                  {selectedUsers.length === 0 && (
                    <p className="text-[11px] text-muted-foreground text-center">
                      You can create a group with just yourself and add members later
                    </p>
                  )}
                </div>
              )
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground px-4"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleStartConversation}
                  disabled={isPending}
                  className="flex-1 h-12 rounded-xl text-base font-semibold gap-2"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MessageCircle className="h-4 w-4" />
                  )}

                  {dmActionLabel}

                </Button>
              </div>
            )}
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
