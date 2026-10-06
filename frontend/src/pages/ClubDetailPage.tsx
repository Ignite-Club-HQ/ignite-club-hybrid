import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClubSetupProgressCard } from "@/components/club/ClubSetupProgressCard";
import ClubLinksManager from "@/components/clubs/ClubLinksManager";
import { clearClubSetupLocalState } from "@/lib/clubSetupLocalState";
import { invalidateTeamLists } from "@/lib/invalidateTeamLists";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Users, Plus, Crown, Settings, Trash2, Pencil, Folder, ChevronDown, ChevronRight, Loader2, Gift, Lock, MessageCircle, ArchiveRestore, Sparkles, FileSpreadsheet } from "lucide-react";
import { sendScheduleBroadcast } from "@/lib/scheduleBroadcast";
import { SwipeableRow } from "@/components/ui/swipeable-row";
import { getSportEmoji } from "@/lib/sportEmojis";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { CreateTeamFolderDialog } from "@/components/CreateTeamFolderDialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useToast } from "@/hooks/use-toast";
import { exportClubRosterCsv } from "@/lib/exportClubRoster";

import { FOLDER_COLORS } from "@/components/TeamFoldersManager";
import ClubRewardsManager from "@/components/ClubRewardsManager";
import { PrimarySponsorDisplay } from "@/components/PrimarySponsorDisplay";
import { PendingTeamRequests } from "@/components/PendingTeamRequests";
import { ClubDMSettings } from "@/components/ClubDMSettings";
import { ClubMessagePrivacySettings } from "@/components/ClubMessagePrivacySettings";
import { ClubAICatchUpSettings } from "@/components/ClubAICatchUpSettings";
import { ClubInviteEmailSettings } from "@/components/ClubInviteEmailSettings";
import { ClubAnnouncementDialog } from "@/components/ClubAnnouncementDialog";
import { CalendarDays, ClipboardCheck, Megaphone, MoreVertical, Link as LinkIcon } from "lucide-react";
import { ClubAdminNavigationSection } from "@/components/club/ClubAdminNavigationSection";
import { ClubQuickActions } from "@/components/club/ClubQuickActions";
import { ClubTeamBrowser } from "@/components/club/ClubTeamBrowser";
import { ClubMembersSection, type ClubMemberEntry } from "@/components/club/ClubMembersSection";
import { ClubArchivedTeamsSection } from "@/components/club/ClubArchivedTeamsSection";
import { ClubMiniLeaguesSection } from "@/components/club/ClubMiniLeaguesSection";
import { ClubBrandingSection } from "@/components/club/ClubBrandingSection";
import { ClubScheduleToolsSection } from "@/components/club/ClubScheduleToolsSection";
import { ClubSponsorsSection, type ClubSponsorToggleField } from "@/components/club/ClubSponsorsSection";
import { ClubEnrolmentsSection } from "@/components/club/ClubEnrolmentsSection";
import { ClubAppAdminSection } from "@/components/club/ClubAppAdminSection";
import { TermsManager } from "@/components/TermsManager";
import { ClassAttendanceManager } from "@/components/ClassAttendanceManager";
import { ClassModeOnboardingGuide } from "@/components/ClassModeOnboardingGuide";
import { TodaysClassesDashboard } from "@/components/TodaysClassesDashboard";

import { MoveToTeamSheet } from "@/components/MoveToTeamSheet";
import ClubRecentGames from "@/components/history/ClubRecentGames";
import ClubCompetitionsSection from "@/components/competitions/ClubCompetitionsSection";
import { friendlyQueryError } from "@/lib/friendlyQueryError";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveSponsors, listLiveTeamSponsorAllocations, getLiveClubProfile, listLiveTeams, listLiveTeamFolders, saveLiveTeamFolder, deleteLiveTeamFolder, setLiveTeamFolder, getLiveClubSubscription, saveLiveClubSubscription, softDeleteLiveTeam, restoreLiveTeam } from "@/live/features/club";
import { markTeamDeleted, unmarkTeamDeleted } from "@/lib/deletedTeamTombstones";
import { listLiveTeamSubscriptions, mapLiveTeamSubscriptionToRow } from "@/live/features/proAccess";
import {
  softDeleteLiveClub,
  restoreLiveClub,
  deleteLiveClubPermanent,
  requestLiveRole,
  getLiveMyRoleGrants,
} from "@/live/features/membership";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import * as fixtureData from "@/lab/fixtureDataLayer";
import { getCachedClub, cacheClub } from "@/lib/clubTeamCache";


type ClubRole = "club_admin";

const clubRoleOptions: { value: ClubRole; label: string }[] = [
  { value: "club_admin", label: "Club Admin" },
];

const MEMBERS_PER_PAGE = 10;

export default function ClubDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const useIcpLab = isFeatureRoutedToIcp("membership");
  // Club deletion/restore and role-request flows have no club_domain canister
  // shape yet, so they are gated off entirely for Internet Identity accounts.
  const isIcpAccount = resolveAuthBackend() === "icp";
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [isExportingRoster, setIsExportingRoster] = useState(false);

  // Deep-link to accordion section via hash (e.g. #branding)
  useEffect(() => {
    const hash = location.hash?.replace("#", "");
    if (!hash) return;
    setOpenSections((prev) => (prev.includes(hash) ? prev : [...prev, hash]));
    // Wait for accordion to expand before scrolling
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-section-anchor="${hash}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
    return () => clearTimeout(t);
  }, [location.hash]);

  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<ClubRole>("club_admin");
  const [displayCount, setDisplayCount] = useState(MEMBERS_PER_PAGE);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [teamSearchQuery, setTeamSearchQuery] = useState("");
  const [broadcastingTeamId, setBroadcastingTeamId] = useState<string | null>(null);

  const handleBroadcastTeamSchedule = async (e: React.MouseEvent, teamId: string, teamName: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (useIcpLab) {
      toast({ title: "Schedule broadcasts are unavailable in ICP lab mode", variant: "destructive" });
      return;
    }
    if (!id || broadcastingTeamId) return;
    setBroadcastingTeamId(teamId);
    const res: { ok: true } | { ok: false; error: string } = await sendScheduleBroadcast(id, teamId);
    setBroadcastingTeamId(null);
    if (res.ok === true) {
      toast({ title: "Schedule refreshed", description: `Pushed a refresh to all ${teamName} members.` });
    } else {
      toast({ title: "Couldn't refresh", description: res.error, variant: "destructive" });
    }
  };
  const [teamFilter, setTeamFilter] = useState<"all" | "junior" | "senior" | "my">("all");
  const [yearLevelFilter, setYearLevelFilter] = useState<string>("all");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [showAllTeams, setShowAllTeams] = useState<boolean | null>(null); // null = not yet initialized
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const draggedTeamRef = useRef<string | null>(null);
  const [moveToTeam, setMoveToTeam] = useState<{ userId: string; userName: string; fromTeamId: string; fromTeamName: string; roles: string[] } | null>(null);
  
  // Folder management state
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<{ id: string; name: string; description: string | null; color: string } | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string } | null>(null);
  const [folderColor, setFolderColor] = useState("default");
  const [announcementDialogOpen, setAnnouncementDialogOpen] = useState(false);

  const { data: club, isLoading } = useQuery({
    queryKey: ["club", id],
    queryFn: async () => {
      if (useIcpLab && id) {
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const row = await getLiveClubProfile(ctx, id);
            const p = row.length ? row[0] : null;
            if (!p) return null;
            // Map the canister profile onto the Supabase clubs row shape this
            // page renders; the canister has no theme-HSL/sponsor columns.
            return {
              id: p.id,
              name: p.name,
              slug: p.slug,
              description: p.description[0] ?? null,
              logo_url: p.logo_url[0] ?? null,
              primary_color: p.primary_color[0] ?? null,
              secondary_color: p.secondary_color[0] ?? null,
              sport: p.sport[0] ?? null,
              is_active: p.is_active,
              deleted_at: p.deleted_at_ms.length ? new Date(Number(p.deleted_at_ms[0])).toISOString() : null,
              // Supabase-only columns with no canister equivalent — render
              // with inert defaults.
              class_mode_enabled: false,
              primary_sponsor_id: null,
              show_logo_in_header: false,
              theme_primary_h: null,
              theme_primary_s: null,
              theme_primary_l: null,
              theme_secondary_h: null,
              theme_secondary_s: null,
              theme_secondary_l: null,
              theme_accent_h: null,
              theme_accent_s: null,
              theme_accent_l: null,
            };
          },
        });
      }

      const { data, error } = await supabase
        .from("clubs")
        .select("*")
        .eq("id", id!)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
    // Open instantly from the saved club name/logo while the full record loads.
    placeholderData: () => {
      const c = id ? getCachedClub(id) : null;
      return c
        ? ({ id: c.id, name: c.name, logo_url: c.logo_url, sport: c.sport, description: null, is_active: true, deleted_at: null, class_mode_enabled: false, primary_sponsor_id: null, show_logo_in_header: false } as any)
        : undefined;
    },
  });
  useEffect(() => {
    if (club?.id && club.name) cacheClub({ id: club.id, name: club.name, logo_url: club.logo_url ?? null, sport: club.sport ?? null, is_pro: !!(club as any).is_pro });
  }, [club?.id, club?.name, club?.logo_url]);


  // Fast count-only query for the badge - returns adults, juniors, total, and growth
  const { data: clubMemberCount, isLoading: isMemberCountLoading, isError: isMemberCountError } = useQuery({
    queryKey: ["club-members-count", id],
    queryFn: async () => {
      if (useIcpLab && id) {
        return { total: 1, adults: 1, juniors: 0, growth: 0, monthChange: 0 };
      }
      // ICP: count unique principals across every team's role grants (team
      // grants are readable by any club member), fetched in parallel. Grants
      // carry no timestamp, so growth is not tracked in ICP mode.
      if (isIcpAccount) {
        const { icpCtx, icpListTeams } = await import("@/lib/icpClubTeamLookup");
        const { listLiveTeamRoleGrants } = await import("@/live/features/membership");
        const ctx = await icpCtx();
        const teamList = await icpListTeams(id!);
        const grantLists = await Promise.all(
          teamList.map((t) => listLiveTeamRoleGrants(ctx, t.id).catch(() => [] as any[])),
        );
        const users = new Set<string>();
        for (const list of grantLists) for (const g of list as any[]) users.add(g.user.toText());
        return { total: users.size, adults: users.size, juniors: 0, growth: 0, monthChange: 0 };
      }

      // Get team IDs for this club (exclude deleted teams)
      const { data: teamsData, error: teamsError } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", id!)
        .is("deleted_at", null);
      if (teamsError) throw teamsError;
      const teamIds = (teamsData || []).map(t => t.id);

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const monthStart = startOfMonth.toISOString();

      // Run all independent queries in parallel
      const [
        clubRolesRes,
        teamRolesRes,
        childAssignmentsRes,
        newClubRolesRes,
        newTeamRolesRes,
      ] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", id!)
          .is("team_id", null),
        teamIds.length > 0
          ? supabase.from("user_roles").select("user_id").in("team_id", teamIds)
          : Promise.resolve({ data: [] as { user_id: string }[], error: null }),
        teamIds.length > 0
          ? supabase.from("child_team_assignments").select("child_id").in("team_id", teamIds)
          : Promise.resolve({ data: [] as { child_id: string }[], error: null }),
        supabase
          .from("user_roles")
          .select("user_id", { count: "exact", head: true })
          .eq("club_id", id!)
          .gte("created_at", monthStart),
        teamIds.length > 0
          ? supabase
              .from("user_roles")
              .select("user_id", { count: "exact", head: true })
              .in("team_id", teamIds)
              .gte("created_at", monthStart)
          : Promise.resolve({ count: 0, error: null }),
      ]);

      // A failed dependency must never be collapsed into a zero count.
      const firstError =
        (clubRolesRes as { error?: unknown }).error ??
        (teamRolesRes as { error?: unknown }).error ??
        (childAssignmentsRes as { error?: unknown }).error ??
        (newClubRolesRes as { error?: unknown }).error ??
        (newTeamRolesRes as { error?: unknown }).error;
      if (firstError) throw friendlyQueryError(firstError, "this club's member numbers");

      const userIdSet = new Set<string>();
      (clubRolesRes.data || []).forEach((r: any) => userIdSet.add(r.user_id));
      (teamRolesRes.data || []).forEach((r: any) => userIdSet.add(r.user_id));
      const adults = userIdSet.size;

      const uniqueChildren = new Set(
        (childAssignmentsRes.data || []).map((a: any) => a.child_id),
      );
      const juniors = uniqueChildren.size;

      const newThisMonth = (newClubRolesRes.count || 0) + (newTeamRolesRes.count || 0);

      return { adults, juniors, total: adults + juniors, newThisMonth };
    },

    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  // Track whether members accordion has been opened
  const [membersExpanded, setMembersExpanded] = useState(false);
  const [teamsExpanded, setTeamsExpanded] = useState<boolean | null>(null);

  // Full roles data - only fetched when the accordion is expanded
  const { data: rawClubMembers = [], isLoading: isMembersLoading, isFetching: isMembersFetching, isError: isMembersError, error: membersError, refetch: refetchClubMembers } = useQuery({
    queryKey: ["club-members-roles", id],
    queryFn: async () => {
      // ICP: build the list from each team's canister role grants plus
      // identity-access profiles (same source as the member count).
      if (isIcpAccount) {
        const { icpCtx, icpListTeams } = await import("@/lib/icpClubTeamLookup");
        const { listLiveTeamRoleGrants } = await import("@/live/features/membership");
        const { listLiveProfilesByIds } = await import("@/live/features/identityAccessClient");
        const ctx = await icpCtx();
        const teamList = await icpListTeams(id!);
        const grantLists = await Promise.all(
          teamList.map(async (t: any) => ({
            team: t,
            grants: (await listLiveTeamRoleGrants(ctx, t.id).catch(() => [])) as any[],
          })),
        );
        const userOf = (g: any): string =>
          g.account_id ?? (g.user?.toText ? g.user.toText() : String(g.user ?? ""));
        const ids = Array.from(new Set(grantLists.flatMap((l) => l.grants.map(userOf)).filter(Boolean)));
        const profiles = (await listLiveProfilesByIds(ctx, ids).catch(() => [])) as any[];
        const byId = new Map(profiles.map((p) => [p.account_id, p]));
        return grantLists.flatMap(({ team, grants }) =>
          grants.map((g) => {
            const uid = userOf(g);
            const p = byId.get(uid);
            return {
              id: `${team.id}:${uid}:${g.role}`,
              user_id: uid,
              role: g.role,
              team_id: team.id,
              club_id: id!,
              profiles: { id: uid, display_name: p?.display_name ?? null, avatar_url: p?.avatar_ref?.[0] ?? p?.avatar_url ?? null, ignite_points: 0 },
              teams: { id: team.id, name: team.name },
            };
          }),
        ) as any[];
      }
      // First get team IDs for this club
      const { data: teamsData } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", id!);
      const teamIds = teamsData?.map(t => t.id) || [];

      // Fetch club-level roles only (club_admin)
      const { data: clubRoles, error: clubError } = await supabase
        .from("user_roles")
        .select("id, user_id, role, team_id, club_id, profiles (id, display_name, avatar_url, ignite_points), teams (id, name)")
        .eq("club_id", id!)
        .is("team_id", null);
      if (clubError) throw friendlyQueryError(clubError, "the club member list");

      // Fetch team-level roles for teams in this club
      let teamRoles: typeof clubRoles = [];
      if (teamIds.length > 0) {
        const { data: teamRolesData, error: teamError } = await supabase
          .from("user_roles")
          .select("id, user_id, role, team_id, club_id, profiles (id, display_name, avatar_url, ignite_points), teams (id, name)")
          .in("team_id", teamIds);
        if (teamError) throw friendlyQueryError(teamError, "the club member list");
        teamRoles = teamRolesData || [];
      }

      // Combine all roles
      const allRoles = [...(clubRoles || []), ...(teamRoles || [])];
      return allRoles;
    },
    enabled: !!id && membersExpanded && !useIcpLab,
    refetchOnMount: true,
  });

  // Group roles by user - use user_id as fallback if profiles.id is missing
  const clubMembers = rawClubMembers.reduce((acc, role) => {
    const userId = role.profiles?.id || role.user_id;
    if (!userId) return acc;
    if (!acc[userId]) {
      acc[userId] = {
        profile: role.profiles,
        roles: [],
      };
    }
    // Determine scope name: team name for team roles, club name for club roles
    const scopeName = role.teams?.name || (role.club_id ? club?.name : undefined);
    // Deduplicate by role id
    const existingRoleIndex = acc[userId].roles.findIndex(r => r.id === role.id);
    if (existingRoleIndex === -1) {
      acc[userId].roles.push({ id: role.id, role: role.role, scopeName, teamId: role.team_id || null, teamName: role.teams?.name || null });
    }
    return acc;
  }, {} as Record<string, ClubMemberEntry>);

  const { data: teams } = useQuery({
    queryKey: ["club-teams", id],
    queryFn: async () => {
      if (useIcpLab && id) {
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const [liveTeams, liveFolders] = await Promise.all([
              listLiveTeams(ctx, id),
              listLiveTeamFolders(ctx, id),
            ]);
            const foldersById = new Map(liveFolders.map((f) => [f.id, f]));
            return liveTeams
              .filter((t) => t.deleted_at_ms.length === 0)
              .map((t) => {
                const folderId = t.folder_id[0] ?? null;
                const folder = folderId ? foldersById.get(folderId) : undefined;
                return {
                  id: t.id,
                  club_id: t.club_id,
                  name: t.name,
                  division: t.division[0] ?? null,
                  gender: t.gender[0] ?? null,
                  age_group: t.age_group[0] ?? null,
                  description: t.description[0] ?? null,
                  logo_url: t.logo_url[0] ?? null,
                  team_type: t.team_type[0] ?? null,
                  is_active: t.is_active,
                  is_archived: t.archived,
                  is_shell: t.is_shell,
                  folder_id: folderId,
                  deleted_at: null,
                  team_folders: folder ? { id: folder.id, name: folder.name } : null,
                };
              })
              .sort((a, b) => a.name.localeCompare(b.name));
          },
        });
      }
      const { data, error } = await supabase
        .from("teams")
        .select("*, team_folders!teams_folder_id_fkey(id, name)")
        .eq("club_id", id!)
        .is("deleted_at", null)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch user's team memberships to show "My Team" badge
  const { data: userTeamIds = [] } = useQuery({
    queryKey: ["user-team-memberships", id, user?.id],
    queryFn: async () => {
      const teamIds = teams?.map(t => t.id) || [];
      if (teamIds.length === 0) return [];

      const { data, error } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .in("team_id", teamIds);
      if (error) throw error;

      return [...new Set((data || []).map(r => r.team_id).filter(Boolean))];
    },
    enabled: !!user && !!teams && teams.length > 0 && !useIcpLab,
  });
  const knownUserTeamIds = userTeamIds.filter((teamId): teamId is string => typeof teamId === "string");


  // Fetch team folders
  const { data: teamFolders = [] } = useQuery({
    queryKey: ["team-folders", id],
    queryFn: async () => {
      if (useIcpLab && id) {
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const rows = await listLiveTeamFolders(ctx, id);
            return rows
              .map((f) => ({
                id: f.id,
                club_id: f.club_id,
                name: f.name,
                description: f.description[0] ?? null,
                color: f.color,
                sort_order: Number(f.sort_order),
                created_by: f.created_by.toText(),
                created_at: new Date(Number(f.created_at_ms)).toISOString(),
              }))
              .sort((a, b) => a.sort_order - b.sort_order);
          },
        });
      }
      const { data, error } = await supabase
        .from("team_folders")
        .select("*")
        .eq("club_id", id!)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch mini leagues for this club
  const { data: miniLeagues = [] } = useQuery({
    queryKey: ["club-mini-leagues", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("*")
        .eq("club_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id && !useIcpLab,
  });

  // Toggle folder expansion
  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));
  };

  // Mutation for moving teams between folders
  const moveTeamToFolderMutation = useMutation({
    mutationFn: async ({ teamId, folderId }: { teamId: string; folderId: string | null }) => {
      if (useIcpLab) {
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => { await setLiveTeamFolder(ctx, teamId, folderId); },
        });
        return;
      }
      const { error } = await supabase
        .from("teams")
        .update({ folder_id: folderId })
        .eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-teams", id] });
      toast({ title: "Team moved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to move team", variant: "destructive" });
    },
  });

  // Folder management mutations
  const createFolderMutation = useMutation({
    mutationFn: async (params: { name: string; description: string; color: string }) => {
      if (useIcpLab) {
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            await saveLiveTeamFolder(ctx, {
              id: crypto.randomUUID(),
              club_id: id!,
              name: params.name,
              description: params.description.trim() ? [params.description.trim()] : [],
              color: params.color,
              sort_order: teamFolders.length,
              created_by: ctx.identity.getPrincipal(),
              created_at_ms: BigInt(Date.now()),
            });
          },
        });
        return;
      }
      const { error } = await supabase.from("team_folders").insert({
        club_id: id!,
        name: params.name,
        description: params.description || null,
        color: params.color,
        sort_order: teamFolders.length,
        created_by: user?.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-folders", id] });
      setCreateFolderDialogOpen(false);
      toast({ title: "Folder created" });
    },
    onError: () => {
      toast({ title: "Failed to create folder", variant: "destructive" });
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: async () => {
      if (!editingFolder) return;
      if (useIcpLab) {
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            await saveLiveTeamFolder(ctx, {
              id: editingFolder.id,
              club_id: id!,
              name: folderName.trim(),
              description: folderDescription.trim() ? [folderDescription.trim()] : [],
              color: folderColor,
              sort_order: (editingFolder as any).sort_order ?? 0,
              created_by: ctx.identity.getPrincipal(),
              created_at_ms: (editingFolder as any).created_at
                ? BigInt(new Date((editingFolder as any).created_at).getTime())
                : BigInt(Date.now()),
            });
          },
        });
        return;
      }
      const { error } = await supabase
        .from("team_folders")
        .update({
          name: folderName.trim(),
          description: folderDescription.trim() || null,
          color: folderColor,
        })
        .eq("id", editingFolder.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-folders", id] });
      setEditingFolder(null);
      setFolderName("");
      setFolderDescription("");
      setFolderColor("default");
      toast({ title: "Folder updated" });
    },
    onError: () => {
      toast({ title: "Failed to update folder", variant: "destructive" });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      if (useIcpLab) {
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => { await deleteLiveTeamFolder(ctx, folderId); },
        });
        return;
      }
      const { error } = await supabase
        .from("team_folders")
        .delete()
        .eq("id", folderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-folders", id] });
      queryClient.invalidateQueries({ queryKey: ["club-teams", id] });
      toast({ title: "Folder deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete folder", variant: "destructive" });
    },
  });

  const handleOpenEditFolder = (folder: typeof teamFolders[0]) => {
    setEditingFolder({ id: folder.id, name: folder.name, description: folder.description, color: folder.color || "default" });
    setFolderName(folder.name);
    setFolderDescription(folder.description || "");
    setFolderColor(folder.color || "default");
  };

  const handleCloseEditFolder = () => {
    setEditingFolder(null);
    setFolderName("");
    setFolderDescription("");
    setFolderColor("default");
  };

  // Drag handlers for teams
  const handleTeamDragStart = (e: React.DragEvent, teamId: string) => {
    if (!isAdmin) return;
    draggedTeamRef.current = teamId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", teamId);
  };

  const handleFolderDragOver = (e: React.DragEvent, folderId: string | null) => {
    if (!isAdmin || !draggedTeamRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverFolderId(folderId);
  };

  const handleFolderDragLeave = () => {
    setDragOverFolderId(null);
  };

  const handleFolderDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDragOverFolderId(null);
    const teamId = draggedTeamRef.current;
    if (!teamId || !isAdmin) return;
    
    // Find the team to check its current folder
    const team = teams?.find(t => t.id === teamId);
    if (team?.folder_id === folderId) {
      draggedTeamRef.current = null;
      return;
    }
    
    moveTeamToFolderMutation.mutate({ teamId, folderId });
    draggedTeamRef.current = null;
  };

  const handleTeamDragEnd = () => {
    draggedTeamRef.current = null;
    setDragOverFolderId(null);
  };

  // Separate active vs archived teams
  const activeTeams = useMemo(() => teams?.filter(t => !(t as any).is_archived) || [], [teams]);
  const archivedTeams = useMemo(() => teams?.filter(t => (t as any).is_archived) || [], [teams]);

  // Group ACTIVE teams by folder
  const groupedTeams = useMemo(() => {
    const byFolder: Record<string, typeof activeTeams> = {};
    const uncategorized: typeof activeTeams = [];
    
    teamFolders.forEach(folder => {
      byFolder[folder.id] = [];
    });
    
    activeTeams.forEach(team => {
      if (team.folder_id && byFolder[team.folder_id]) {
        byFolder[team.folder_id].push(team);
      } else {
        uncategorized.push(team);
      }
    });
    
    return { uncategorized, byFolder };
  }, [activeTeams, teamFolders]);
  
  // Helper to check if team should be visible based on showAllTeams toggle
  const shouldShowTeam = (teamId: string) => {
    if (effectiveShowAllTeams) return true;
    return userTeamIds.includes(teamId);
  };
  
  // Count user's teams for display
  const myTeamsCount = useMemo(() => {
    return activeTeams.filter(t => userTeamIds.includes(t.id)).length;
  }, [activeTeams, userTeamIds]);

  const { data: userRole } = useQuery({
    queryKey: ["user-club-role", id, user?.id],
    queryFn: async () => {
      if (isFeatureRoutedToIcp("membership")) {
        // Live ICP: own role grants from club_domain (no Supabase user_roles
        // rows exist for II accounts). Mirror of TeamDetailPage's check.
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const grants = await getLiveMyRoleGrants(ctx);
            const roles = grants
              .filter((g) => (g.club?.[0] ?? null) === id!)
              .map((g) => g.role);
            return roles.includes("club_admin") ? "club_admin" : roles[0] ?? null;
          },
        });
      }
      // Check for club_admin role - can have team_id null OR be associated with a team in this club
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("club_id", id!)
        .eq("role", "club_admin")
        .limit(1)
        .maybeSingle();

      if (data?.role) return data.role;

      // Also check for club-level roles with team_id null (non-admin roles)
      const { data: clubLevelRole } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("club_id", id!)
        .is("team_id", null)
        .limit(1)
        .maybeSingle();

      return clubLevelRole?.role ?? null;
    },
    enabled: !!id && !!user && !useIcpLab,
  });

  // Shared hook: Supabase user_roles in Supabase mode, insights_domain's
  // is_app_admin in ICP mode (the inline Supabase-only query used to own this
  // cache key and always resolved false for II accounts).
  const { isAppAdmin } = useIsAppAdmin();

  const { data: canImportFixtures } = useQuery({
    queryKey: ["can-import-fixtures", id, user?.id],
    queryFn: async () => {
      if (!id || !user) return false;
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("club_id", id)
        .in("role", ["club_admin", "team_admin", "coach", "committee_member"]);
      if (error) throw error;
      return (roles?.length ?? 0) > 0;
    },
    enabled: !!id && !!user && !useIcpLab,
  });

  const isAdmin = userRole === "club_admin" || isAppAdmin;
  const isMember = !!userRole || isAppAdmin;

  // Fetch pending invites for this club
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites", null, id, isAdmin],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, role, invited_user_id, invited_label, invited_email, created_at, status, email_sent_at, email_id, email_error, last_reminder_sent_at, reminder_count, metadata")
        .eq("club_id", id!)
        .is("team_id", null)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      
      // Filter out anonymous share-link invites with no identifying info,
      // and mini-league share/join links (they belong to the mini-league hub, not club members)
      const MINI_LEAGUE_LINK_KINDS = new Set([
        "mini_league_parent_join_link",
        "league_admin_join_link",
        "mini_league_admin_join_link",
      ]);
      const identifiableInvites = (data || []).filter(
        inv =>
          (inv.invited_label || inv.invited_email || inv.invited_user_id) &&
          !MINI_LEAGUE_LINK_KINDS.has((inv.metadata as any)?.kind)
      );
      
      // Fetch profile data separately for invited users
      const invitesWithProfiles = await Promise.all(
        identifiableInvites.map(async (invite) => {
          if (invite.invited_user_id) {
            const { data: profile } = await selectCachedProfileById(invite.invited_user_id);
            return { ...invite, profiles: profile };
          }
          return { ...invite, profiles: null };
        })
      );
      
      return invitesWithProfiles;
    },
    enabled: !!id && isAdmin === true && !useIcpLab,
    staleTime: 0,
  });
  
  // Initialize showAllTeams based on admin status (once we know it)
  // Admins see all teams by default, non-admins see only their teams
  // Default to true while loading to avoid hiding teams during initial render
  const effectiveShowAllTeams = showAllTeams !== null ? showAllTeams : (isAdmin !== false ? true : false);
  
  // Fetch team subscriptions to show Pro status badges
  const { data: teamSubscriptions = [] } = useQuery({
    queryKey: ["club-team-subscriptions", id],
    queryFn: async () => {
      const teamIds = teams?.map(t => t.id) || [];
      if (teamIds.length === 0) return [];
      // ICP: Pro badges come from the club_domain team subscription records.
      if (useIcpLab) {
        return withFeatureBackend("membership", {
          supabase: async () => [],
          icp: async (ctx) => {
            const subs = await listLiveTeamSubscriptions(ctx, teamIds);
            return teamIds
              .map((teamId) => subs.get(teamId))
              .filter((s): s is NonNullable<typeof s> => !!s)
              .map(mapLiveTeamSubscriptionToRow);
          },
        });
      }
      const { data } = await supabase
        .from("team_subscriptions")
        .select("*")
        .in("team_id", teamIds);
      return data || [];
    },
    enabled: !!teams && teams.length > 0,
  });

  // Fetch team sponsor allocations with sponsor details
  const { data: teamSponsorAllocations = [] } = useQuery({
    queryKey: ["club-team-sponsors", id],
    queryFn: async () => {
      const teamIds = teams?.map(t => t.id) || [];
      if (teamIds.length === 0) return [];
      if (useIcpLab) {
        return withFeatureBackend("membership", {
          supabase: async () => [],
          icp: async (ctx) => {
            // Sponsor details join from the club's sponsor list; the canister
            // allocation rows carry no nested sponsor record.
            const [allSponsors, allocations] = await Promise.all([
              listLiveSponsors(ctx, id!),
              listLiveTeamSponsorAllocations(ctx, id!),
            ]);
            const sponsorById = new Map(
              (allSponsors as Array<{ id: string; name: string; logo_url: [] | [string]; website_url: [] | [string] }>)
                .map((s) => [s.id, { id: s.id, name: s.name, logo_url: s.logo_url[0] ?? null, website_url: s.website_url[0] ?? null }]),
            );
            return (allocations as Array<{ team_id: string; sponsor_id: string; allocated: boolean }>)
              .filter((a) => a.allocated && teamIds.includes(a.team_id))
              .map((a) => ({ ...a, sponsors: sponsorById.get(a.sponsor_id) }));
          },
        });
      }
      const { data } = await supabase
        .from("team_sponsor_allocations")
        .select("*, sponsors(*)")
        .in("team_id", teamIds);
      return data || [];
    },
    enabled: !!teams && teams.length > 0,
  });

  // Helper to get first sponsor for a team
  const getTeamSponsor = (teamId: string) => {
    const allocation = teamSponsorAllocations.find(a => a.team_id === teamId);
    return allocation?.sponsors as { id: string; name: string; logo_url: string | null; website_url: string | null } | undefined;
  };

  // Fetch club subscription
  const { data: clubSubscription } = useQuery({
    queryKey: ["club-subscription", id],
    queryFn: async () => {
      if (useIcpLab && id) {
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const sub = await getLiveClubSubscription(ctx, id);
            if (!sub) return null;
            return {
              club_id: sub.club_id,
              is_pro: sub.is_pro,
              is_pro_football: sub.is_pro_football,
              plan: sub.plan,
              admin_pro_override: sub.admin_pro_override,
              admin_pro_football_override: sub.admin_pro_football_override,
              team_limit: sub.team_limit.length ? Number(sub.team_limit[0]) : null,
              is_trial: sub.is_trial,
              trial_ends_at: sub.trial_ends_at_ms.length
                ? new Date(Number(sub.trial_ends_at_ms[0])).toISOString()
                : null,
            };
          },
        });
      }
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", id!)
        .maybeSingle();
      return data;
    },
    enabled: !!id,
  });

  // Check for existing pending request
  const { data: existingRequest } = useQuery({
    queryKey: ["club-request", id, user?.id],
    queryFn: async () => {
      if (useIcpLab) return null;
      if (isIcpAccount) return null;
      const { data } = await supabase
        .from("role_requests")
        .select("*")
        .eq("club_id", id!)
        .eq("user_id", user!.id)
        .eq("status", "pending")
        .maybeSingle();
      return data;
    },
    enabled: !!id && !!user && !isMember && !useIcpLab && !isIcpAccount,
  });

  const requestRoleMutation = useMutation({
    mutationFn: async () => {
      await withFeatureBackend("membership", {
        supabase: async () => {
          const { error } = await supabase.from("role_requests").insert({
            user_id: user!.id,
            club_id: id!,
            role: selectedRole,
          });
          if (error) throw error;
          // Admin notifications are created by the on_role_request_created DB
          // trigger (which includes the requester's name). No client-side
          // insert needed.
        },
        icp: async (ctx) => { await requestLiveRole(ctx, id!, selectedRole); },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-request", id] });
      setRequestDialogOpen(false);
      toast({ title: "Request submitted", description: "An admin will review your request." });
    },
    onError: () => {
      toast({ title: "Failed to submit request", variant: "destructive" });
    },
  });

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPermanentDeleteDialog, setShowPermanentDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const safeErrMessage = (err: unknown): string => {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    const msg = (err as { message?: unknown }).message;
    return typeof msg === "string" && msg ? msg : "Unknown error";
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    // Club soft-delete on the canister has no team/chat cascade or
    // notification equivalent, so handle the ICP branch separately and skip
    // the Supabase-only cascade/notification steps below.
    if (isFeatureRoutedToIcp("membership")) {
      try {
        await withFeatureBackend("membership", {
          supabase: () => softDeleteLiveClub({} as any, id!, true), // unreachable: gated above
          icp: async (ctx) => {
            const deleted = await softDeleteLiveClub(ctx, id!, true);
            // Cascade explicitly: older deployed canisters may predate the
            // canister-side team cascade, so soft-delete each team ourselves
            // (best-effort per team) and tombstone them locally so no stale
            // cache can render them again.
            try {
              const teams = (await listLiveTeams(ctx, id!)) as unknown as { id: string; deleted_at_ms?: unknown }[];
              for (const team of teams || []) {
                if (!team?.id || (Array.isArray(team.deleted_at_ms) && team.deleted_at_ms.length)) continue;
                try {
                  await softDeleteLiveTeam(ctx, team.id);
                } catch { /* already gone or not permitted — tombstone anyway */ }
                markTeamDeleted(team.id);
              }
            } catch { /* listing failed — club delete still committed */ }
            return deleted;
          },
        });
        setShowDeleteDialog(false);
        clearClubSetupLocalState(id!);
        queryClient.invalidateQueries({ queryKey: ["club", id] });
        queryClient.invalidateQueries({ queryKey: ["clubs"] });
        // Cascade tombstoned the club's teams too — refresh the home
        // carousel (React Query + localStorage snapshot) and every other
        // team-derived list so deleted teams disappear immediately.
        await invalidateTeamLists(queryClient, user?.id);
        toast({ title: "Club deleted", description: "You can restore it within 30 days from the clubs page." });
        navigate("/clubs");
      } catch (err) {
        toast({ title: "Error", description: `Failed to delete club: ${safeErrMessage(err)}`, variant: "destructive" });
      } finally {
        setIsDeleting(false);
      }
      return;
    }
    try {
      // 1. Load the club's team IDs
      const { data: teamsData, error: teamsErr } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", id!);
      if (teamsErr) {
        toast({
          title: "Error",
          description: `Failed to delete club: ${safeErrMessage(teamsErr)}`,
          variant: "destructive",
        });
        return;
      }
      const teamIds = (teamsData || []).map((t) => t.id);

      // 2. Load + dedupe notification recipients (club-level and team-level)
      const { data: clubMembersData } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", id!);

      let teamMembers: { user_id: string }[] = [];
      if (teamIds.length > 0) {
        const { data } = await supabase
          .from("user_roles")
          .select("user_id")
          .in("team_id", teamIds);
        teamMembers = data || [];
      }

      const allMemberIds = [
        ...new Set([
          ...(clubMembersData || []).map((m) => m.user_id),
          ...teamMembers.map((m) => m.user_id),
        ]),
      ].filter((uid) => uid && uid !== user?.id);

      // 3. Confirm subscription cancellation BEFORE any destructive write.
      // A club subscription that keeps billing after deletion is unacceptable,
      // so an unconfirmed cancellation blocks the whole operation.
      let cancelError: string | null = null;
      try {
        const { data: cancelData, error: cancelErr } = await supabase.functions.invoke(
          "cancel-subscription",
          { body: { subscription_type: "club", entity_id: id! } },
        );
        if (cancelErr) cancelError = safeErrMessage(cancelErr);
        else if (cancelData && (cancelData as any).error) {
          cancelError = safeErrMessage((cancelData as any).error);
        } else if (cancelData && (cancelData as any).success === false) {
          cancelError = "Cancellation was not confirmed by the billing service.";
        }
      } catch (err) {
        cancelError = safeErrMessage(err);
      }

      if (cancelError) {
        toast({
          title: "Club deletion blocked",
          description: `Billing cancellation could not be confirmed, so the club was not deleted. ${cancelError}`,
          variant: "destructive",
        });
        return;
      }

      // 4. Soft-delete the club FIRST. Nothing downstream happens if this fails.
      const deletedAt = new Date().toISOString();
      const { error: clubError } = await supabase
        .from("clubs")
        .update({ deleted_at: deletedAt, deleted_by: user?.id } as any)
        .eq("id", id!);

      if (clubError) {
        toast({
          title: "Error",
          description: `Failed to delete club: ${safeErrMessage(clubError)}`,
          variant: "destructive",
        });
        return;
      }

      // Club deletion has committed. Downstream failures are partial success.
      const outcome: {
        clubDeletionSucceeded: boolean;
        teamCleanupError: string | null;
        chatCleanupError: string | null;
        notificationError: string | null;
      } = {
        clubDeletionSucceeded: true,
        teamCleanupError: null,
        chatCleanupError: null,
        notificationError: null,
      };

      // 5. Soft-delete only the club's ACTIVE teams (leave already-deleted ones alone)
      if (teamIds.length > 0) {
        const { error: teamErr } = await supabase
          .from("teams")
          .update({ deleted_at: deletedAt, deleted_by: user?.id } as any)
          .in("id", teamIds)
          .is("deleted_at", null);
        if (teamErr) outcome.teamCleanupError = safeErrMessage(teamErr);
      }

      // 6. Soft-delete only active chat groups scoped to this club or its teams
      {
        const orClauses = [`club_id.eq.${id!}`];
        if (teamIds.length > 0) orClauses.push(`team_id.in.(${teamIds.join(",")})`);
        const { error: chatErr } = await supabase
          .from("chat_groups")
          .update({ deleted_at: deletedAt, deleted_by: user?.id } as any)
          .or(orClauses.join(","))
          .is("deleted_at", null);
        if (chatErr) outcome.chatCleanupError = safeErrMessage(chatErr);
      }

      // 7. Notify members only after the club deletion committed
      if (allMemberIds.length > 0) {
        const { withFeatureBackend } = await import("@/live/featureRouter");
        const { fanOutLiveNotifications } = await import("@/live/features/notifications");
        await withFeatureBackend("notifications", {
          supabase: async () => {
            const { error: notifyErr } = await supabase.from("notifications").insert(
              allMemberIds.map((uid) => ({
                user_id: uid,
                type: "membership",
                message: `${club?.name || "A club"} has been deleted`,
                related_id: null,
              })),
            );
            if (notifyErr) outcome.notificationError = safeErrMessage(notifyErr);
          },
          icp: async (ctx) => {
            try {
              await fanOutLiveNotifications(ctx, {
                userIds: allMemberIds,
                clubId: id!,
                kind: "membership",
                body: `${club?.name || "A club"} has been deleted`,
                idempotencyKeyPrefix: `club-deletion-${id}-${Date.now()}`,
                relatedId: null,
              });
            } catch (e) {
              outcome.notificationError = e instanceof Error ? e.message : String(e);
            }
          }
        });
      }

      setShowDeleteDialog(false);
      clearClubSetupLocalState(id!);
      queryClient.invalidateQueries({ queryKey: ["club", id] });
      queryClient.invalidateQueries({ queryKey: ["club-teams", id] });
      queryClient.invalidateQueries({ queryKey: ["clubs"] });
      queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["club-members", id] });
      await invalidateTeamLists(queryClient, user?.id);

      const cleanupFailures: string[] = [];
      if (outcome.teamCleanupError) cleanupFailures.push(`teams (${outcome.teamCleanupError})`);
      if (outcome.chatCleanupError) cleanupFailures.push(`chats (${outcome.chatCleanupError})`);

      if (cleanupFailures.length > 0) {
        const notifPart = outcome.notificationError
          ? ` Notifications also failed (${outcome.notificationError}).`
          : "";
        toast({
          title: "Club deleted — cleanup incomplete",
          description: `The club was deleted, but cleanup failed for: ${cleanupFailures.join(", ")}.${notifPart}`,
          variant: "destructive",
        });
      } else if (outcome.notificationError) {
        toast({
          title: "Club deleted — notifications failed",
          description: `The club was deleted, but some members may not have been notified. ${outcome.notificationError}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Club deleted",
          description: "You can restore it within 30 days from the clubs page.",
        });
      }

      navigate("/clubs");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRestoreClub = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    if (isFeatureRoutedToIcp("membership")) {
      try {
        await withFeatureBackend("membership", {
          supabase: () => restoreLiveClub({} as any, id!, true), // unreachable: gated above
          icp: async (ctx) => {
            const restored = await restoreLiveClub(ctx, id!, true);
            // Mirror the delete branch: restore each team explicitly (older
            // canisters lack the cascade) and lift the local tombstones.
            try {
              const teams = (await listLiveTeams(ctx, id!)) as unknown as { id: string; deleted_at_ms?: unknown }[];
              for (const team of teams || []) {
                if (!team?.id) continue;
                if (Array.isArray(team.deleted_at_ms) && team.deleted_at_ms.length) {
                  try { await restoreLiveTeam(ctx, team.id); } catch { /* best-effort */ }
                }
                unmarkTeamDeleted(team.id);
              }
            } catch { /* listing failed — club restore still committed */ }
            return restored;
          },
        });
        queryClient.invalidateQueries({ queryKey: ["club", id] });
        await invalidateTeamLists(queryClient, user?.id);
        toast({ title: "Club restored!" });
      } catch (err) {
        toast({ title: "Error", description: `Failed to restore club: ${safeErrMessage(err)}`, variant: "destructive" });
      } finally {
        setIsRestoring(false);
      }
      return;
    }
    try {
      // Capture the deletion marker BEFORE clearing it so we only restore what
      // was deleted as part of the same club-deletion operation.
      const capturedDeletedAt = (club as any)?.deleted_at as string | null | undefined;

      const { error: clubError } = await supabase
        .from("clubs")
        .update({ deleted_at: null, deleted_by: null } as any)
        .eq("id", id!);

      if (clubError) {
        toast({
          title: "Error",
          description: `Failed to restore club: ${safeErrMessage(clubError)}`,
          variant: "destructive",
        });
        return;
      }

      let teamRestoreError: string | null = null;
      let chatRestoreError: string | null = null;

      if (capturedDeletedAt) {
        const { error: teamErr } = await supabase
          .from("teams")
          .update({ deleted_at: null, deleted_by: null } as any)
          .eq("club_id", id!)
          .eq("deleted_at", capturedDeletedAt);
        if (teamErr) teamRestoreError = safeErrMessage(teamErr);

        const { data: teamRows } = await supabase
          .from("teams")
          .select("id")
          .eq("club_id", id!);
        const teamIdList = (teamRows || []).map((t: any) => t.id);
        const orClauses = [`club_id.eq.${id!}`];
        if (teamIdList.length > 0) orClauses.push(`team_id.in.(${teamIdList.join(",")})`);
        const { error: chatErr } = await supabase
          .from("chat_groups")
          .update({ deleted_at: null, deleted_by: null } as any)
          .or(orClauses.join(","))
          .eq("deleted_at", capturedDeletedAt);
        if (chatErr) chatRestoreError = safeErrMessage(chatErr);
      }

      queryClient.invalidateQueries({ queryKey: ["club", id] });
      queryClient.invalidateQueries({ queryKey: ["club-teams", id] });
      queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
      await invalidateTeamLists(queryClient, user?.id);

      const failures: string[] = [];
      if (teamRestoreError) failures.push(`teams (${teamRestoreError})`);
      if (chatRestoreError) failures.push(`chats (${chatRestoreError})`);

      if (failures.length > 0) {
        toast({
          title: "Club restored — restore incomplete",
          description: `The club was restored, but restoring failed for: ${failures.join(", ")}.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Club restored!" });
      }
    } finally {
      setIsRestoring(false);
    }
  };


  const handlePermanentDeleteClub = async () => {
    setIsDeleting(true);
    try {
      await withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase.functions.invoke("permanent-delete-entity", {
            body: { entityType: "club", entityId: id },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
        },
        icp: (ctx) => deleteLiveClubPermanent(ctx, id!),
      });

      setShowPermanentDeleteDialog(false);
      toast({ title: "Club permanently deleted", description: "All data has been removed." });
      navigate("/clubs");
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to permanently delete club.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  // Mutation for app admins to toggle club Pro status
  const toggleClubProMutation = useMutation({
    mutationFn: async ({ isPro, isProFootball }: { isPro: boolean; isProFootball: boolean }) => {
      if (useIcpLab) {
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const existing = await getLiveClubSubscription(ctx, id!);
            const nowMs = BigInt(Date.now());
            const base = existing ?? {
              club_id: id!,
              is_pro: false,
              is_pro_football: false,
              admin_pro_override: false,
              admin_pro_football_override: false,
              expires_at_ms: [] as [] | [bigint],
              plan: "free",
              team_limit: [] as [] | [number],
              trial_ends_at_ms: [] as [] | [bigint],
              is_trial: false,
              cancelled_at_ms: [] as [] | [bigint],
              activated_at_ms: [] as [] | [bigint],
            };
            await saveLiveClubSubscription(ctx, {
              ...base,
              is_pro: isPro,
              is_pro_football: isProFootball,
              admin_pro_override: isPro,
              admin_pro_football_override: isProFootball,
              activated_at_ms: isPro || isProFootball ? [nowMs] : base.activated_at_ms,
              expires_at_ms: [], // Admin-enabled = no expiry
            });
          },
        });
        return;
      }
      // Check if subscription record exists
      if (clubSubscription) {
        // Update existing subscription
        const { error } = await supabase
          .from("club_subscriptions")
          .update({
            is_pro: isPro,
            is_pro_football: isProFootball,
            activated_at: isPro || isProFootball ? new Date().toISOString() : null,
            expires_at: null, // Admin-enabled = no expiry
          })
          .eq("club_id", id!);
        if (error) throw error;
      } else {
        // Create new subscription record
        const { error } = await supabase
          .from("club_subscriptions")
          .insert({
            club_id: id!,
            is_pro: isPro,
            is_pro_football: isProFootball,
            plan: "unlimited",
            team_limit: null,
            activated_at: isPro || isProFootball ? new Date().toISOString() : null,
            expires_at: null,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-subscription", id] });
      queryClient.invalidateQueries({ queryKey: ["club", id] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-clubs"] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-teams"] });
      queryClient.invalidateQueries({ queryKey: ["team-subscriptions"] });
      toast({ title: "Club subscription updated" });
    },
    onError: () => {
      toast({ title: "Failed to update subscription", variant: "destructive" });
    },
  });

  const handleToggleClubPro = (checked: boolean) => {
    toggleClubProMutation.mutate({
      isPro: checked,
      isProFootball: checked ? (clubSubscription?.is_pro_football || false) : false,
    });
  };

  const handleToggleClubProFootball = (checked: boolean) => {
    // Pro Football includes Pro - enabling Pro Football automatically enables Pro
    toggleClubProMutation.mutate({
      isPro: checked ? true : (clubSubscription?.is_pro || false),
      isProFootball: checked,
    });
  };

  const isSoccerClub = club?.sport?.toLowerCase().includes("soccer") || 
                       club?.sport?.toLowerCase().includes("football") || 
                       club?.sport?.toLowerCase().includes("futsal");

  const { hasProFootball } = useClubProAccess(id);


  if (isLoading) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!club) {
    return (
      <div className="py-6 text-center space-y-3">
        <p className="text-muted-foreground">Club not found</p>
        <button
          type="button"
          onClick={() => navigate("/clubs", { replace: true })}
          className="text-sm font-medium text-primary underline underline-offset-4"
        >
          Back to Clubs &amp; Teams
        </button>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/clubs")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold flex-1 truncate">{club.name}</h1>
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Club settings">
                <Settings className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`/clubs/${id}/edit`)}>
                <Pencil className="h-4 w-4 mr-2" />
                {club?.class_mode_enabled ? "Edit Organisation" : "Edit Club"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(`/clubs/${id}/seasons`)}>
                <Sparkles className="h-4 w-4 mr-2" />
                Manage Seasons
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {club?.class_mode_enabled ? "Delete Organisation" : "Delete Club"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Soft-deleted banner */}
      {(club as any)?.deleted_at && isAdmin && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center gap-3">
              <Trash2 className="h-5 w-5 text-destructive shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">
                  This {club?.class_mode_enabled ? "organisation" : "club"} has been removed
                </p>
                <p className="text-xs text-muted-foreground">
                  Removed {new Date((club as any).deleted_at).toLocaleDateString()} · Will be permanently deleted after 30 days
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={handleRestoreClub} disabled={isRestoring}>
                <ArchiveRestore className="h-4 w-4 mr-1" />
                Restore
              </Button>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              onClick={() => setShowPermanentDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Permanently Delete
            </Button>
          </CardContent>
        </Card>
      )}

      <ConfirmDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        entityName={club.name}
        entityType={club?.class_mode_enabled ? "organisation" : "club"}
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />

      <ConfirmDeleteDialog
        open={showPermanentDeleteDialog}
        onOpenChange={setShowPermanentDeleteDialog}
        entityName={club.name}
        entityType={club?.class_mode_enabled ? "organisation" : "club"}
        onConfirm={handlePermanentDeleteClub}
        isLoading={isDeleting}
        permanent
      />

      {/* Club Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={club.logo_url || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-xl">
                {club.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold">{club.name}</h2>
                {(clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override) && (
                  <Badge className="bg-emerald-500 text-emerald-950 text-xs">
                    <Crown className="h-3 w-3 mr-1" /> Pro Football
                  </Badge>
                )}
                {(clubSubscription?.is_pro || clubSubscription?.admin_pro_override) && 
                 !(clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override) && (
                  <Badge className="bg-yellow-500 text-yellow-950 text-xs">
                    <Crown className="h-3 w-3 mr-1" /> Pro
                  </Badge>
                )}
              </div>
              {club.description && (
                <p className="text-muted-foreground mt-1">{club.description}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upgrade Banner for Free Users */}
      {/* Only show if club doesn't have Pro AND user has a reason to see it:
          - Admins can always see (they can upgrade)
          - Non-admins only see if they're on a team without Pro */}
      {!clubSubscription?.is_pro && !clubSubscription?.admin_pro_override && (() => {
        // Check if user is on any team that doesn't have Pro
        const userTeamsWithoutPro = userTeamIds.filter(teamId => {
          const teamSub = teamSubscriptions.find(ts => ts.team_id === teamId);
          const teamHasPro = teamSub?.is_pro || teamSub?.is_pro_football || 
                             (teamSub as any)?.admin_pro_override || (teamSub as any)?.admin_pro_football_override;
          return !teamHasPro;
        });
        
        // Show banner if: user is admin OR user has at least one team without Pro
        // If user is only on teams that have Pro, don't show
        const shouldShow = isAdmin || (userTeamIds.length > 0 && userTeamsWithoutPro.length > 0);
        
        if (!shouldShow) return null;
        
        return (
          <Card className="border-primary/30 bg-gradient-to-r from-primary/10 to-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-primary/20">
                    <Crown className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">
                      {isAdmin ? "Upgrade to Pro" : "Pro Features Available"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {isAdmin 
                        ? `Unlock Vault, Media, Rewards & more for your ${club?.class_mode_enabled ? "organisation" : "club"}`
                        : `Contact your ${club?.class_mode_enabled ? "organisation" : "club"} admin to unlock Pro features`
                      }
                    </p>
                  </div>
                </div>
                {isAdmin && (
                  <Link to={`/clubs/${id}/upgrade`}>
                    <Button size="sm" className="shrink-0">
                      Upgrade
                    </Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Setup progress — only visible to club admins of THIS club */}
      {userRole === "club_admin" && id && (
        <ClubSetupProgressCard clubId={id} isShellClub={(club as any)?.kind === "shell"} />
      )}






      {/* Subscription Banner - Show for admins when club has an active trial */}
      {isAdmin && clubSubscription?.is_trial && (clubSubscription?.is_pro || clubSubscription?.is_pro_football) && (
        <Card className={`border-amber-500/30 ${(clubSubscription as any)?.cancelled_at ? 'bg-gradient-to-r from-muted/50 to-muted/30' : 'bg-gradient-to-r from-amber-500/5 to-amber-500/10'}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`rounded-full p-2 shrink-0 ${(clubSubscription as any)?.cancelled_at ? 'bg-muted' : 'bg-amber-500/10'}`}>
                <Crown className={`h-5 w-5 ${(clubSubscription as any)?.cancelled_at ? 'text-muted-foreground' : 'text-amber-500'}`} />
              </div>
              <div className="flex-1 min-w-0">
                {(clubSubscription as any)?.cancelled_at ? (
                  <>
                    <p className="font-medium text-sm">Subscription Cancelled</p>
                    <p className="text-xs text-muted-foreground">
                      Pro features active until {clubSubscription?.trial_ends_at ? new Date(clubSubscription.trial_ends_at).toLocaleDateString() : 'trial ends'}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-sm">Free Trial Active</p>
                    <p className="text-xs text-muted-foreground">
                      Trial ends {clubSubscription?.trial_ends_at ? new Date(clubSubscription.trial_ends_at).toLocaleDateString() : 'soon'}
                    </p>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Class Mode Onboarding Guide */}
      {isAdmin && club?.class_mode_enabled && (
        <ClassModeOnboardingGuide clubId={id!} />
      )}

      {/* Today's Classes Dashboard */}
      {isAdmin && club?.class_mode_enabled && (
        <TodaysClassesDashboard clubId={id!} />
      )}

      {/* Recent Games — basketball + netball only, hides itself if empty */}
      

      {/* Primary Sponsor Display — only shown while club is on Pro */}
      {club?.primary_sponsor_id && (clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override) && (
        <PrimarySponsorDisplay sponsorId={club.primary_sponsor_id} variant="full" context="club_page" />
      )}

      {isMember && id && (
        <ClubQuickActions
          clubId={id}
          classModeEnabled={!!club?.class_mode_enabled}
          hasProAccess={!!(
            clubSubscription?.is_pro
            || clubSubscription?.is_pro_football
            || clubSubscription?.admin_pro_override
            || clubSubscription?.admin_pro_football_override
          )}
        />
      )}




      {/* Teams Section - flat filtered list */}
      {(() => {
        const totalTeams = activeTeams?.length ?? 0;
        const collapsible = totalTeams > 5;
        const isExpanded = collapsible ? (teamsExpanded ?? false) : true;
        return (
      <section className="space-y-4">
        {/* Header with title, count, and Add Team */}
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={() => collapsible && setTeamsExpanded((v) => !(v ?? false))}
            className={`flex items-center gap-1.5 min-w-0 flex-1 text-left ${collapsible ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default"}`}
            aria-expanded={isExpanded}
            disabled={!collapsible}
          >
            <Users className="h-5 w-5 text-primary shrink-0" />
            <h2 className="text-lg font-semibold">{club?.class_mode_enabled ? "Classes" : "Teams"}</h2>
            {activeTeams && <Badge className="font-semibold bg-primary/20 text-primary dark:text-primary-foreground dark:bg-primary">{activeTeams.length}</Badge>}
            {collapsible && (
              isExpanded
                ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </button>
          {isAdmin && (
            <div className="flex items-center gap-1 shrink-0">
              <Link to={`/clubs/${id}/teams/new`}>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> {club?.class_mode_enabled ? "Add Class" : "Add Team"}
                </Button>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground"
                    aria-label="More admin actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setAnnouncementDialogOpen(true);
                    }}
                  >
                    <Megaphone className="h-4 w-4 mr-2 text-primary" />
                    Broadcast message
                  </DropdownMenuItem>
                  {/* NEEDS-CANISTER: no club-wide player/guardian roster read exists
                      on club_domain yet, so the export is hidden for Internet
                      Identity accounts rather than firing Supabase. */}
                  {!isIcpAccount && (
                  <DropdownMenuItem
                    disabled={isExportingRoster}
                    onSelect={async (e) => {
                      e.preventDefault();
                      if (!id) return;
                      setIsExportingRoster(true);
                      try {
                        const count = await exportClubRosterCsv(id, club?.name ?? "club");
                        toast({
                          title: count > 0 ? "Player list exported" : "No players to export",
                          description:
                            count > 0
                              ? `${count} player ${count === 1 ? "entry" : "entries"} across your ${club?.class_mode_enabled ? "classes" : "teams"}.`
                              : "Add players to your teams first.",
                        });
                      } catch (err: any) {
                        toast({
                          title: "Couldn't export player list",
                          description: err?.message ?? "Please try again.",
                          variant: "destructive",
                        });
                      } finally {
                        setIsExportingRoster(false);
                      }
                    }}
                  >
                    {isExportingRoster ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                    )}
                    Export player list
                  </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {isExpanded && (<>

        {isAdmin && <PendingTeamRequests clubId={id!} />}



        <ClubTeamBrowser
          clubId={id!}
          classModeEnabled={!!club?.class_mode_enabled}
          isAdmin={isAdmin}
          teams={activeTeams}
          userTeamIds={knownUserTeamIds}
          teamSubscriptions={teamSubscriptions}
          clubSubscription={clubSubscription}
          teamFilter={teamFilter}
          yearLevelFilter={yearLevelFilter}
          searchQuery={teamSearchQuery}
          onTeamFilterChange={setTeamFilter}
          onYearLevelFilterChange={setYearLevelFilter}
          onSearchQueryChange={setTeamSearchQuery}
        />
        </>)}
      </section>
        );
      })()}

      {/* Archived Teams Section - admins only */}
      {isAdmin && archivedTeams.length > 0 && (
        <ClubArchivedTeamsSection clubId={id!} archivedTeams={archivedTeams} />
      )}

      {/* Competitions Section - Pro only */}
      {(() => {
        const hasProAccess = !!(isAppAdmin || clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override);
        return (
          <ClubCompetitionsSection clubId={id!} teamIds={knownUserTeamIds} isAdmin={isAdmin} hasProAccess={hasProAccess} />
        );
      })()}

      {/* Mini Leagues Section - Pro Football clubs only, hidden for class-mode clubs */}
      {isSoccerClub && hasProFootball && !club?.class_mode_enabled && (isAdmin || miniLeagues.length > 0) && (
        <ClubMiniLeaguesSection clubId={id!} isAdmin={isAdmin} miniLeagues={miniLeagues} />
      )}

      <Dialog open={!!editingFolder} onOpenChange={(open) => !open && handleCloseEditFolder()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-folder-name">Folder Name</Label>
              <Input
                id="edit-folder-name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-folder-description">Description (optional)</Label>
              <Textarea
                id="edit-folder-description"
                value={folderDescription}
                onChange={(e) => setFolderDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Folder Color</Label>
              <div className="flex flex-wrap gap-2">
                {FOLDER_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => setFolderColor(color.value)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${color.bgClassName} ${
                      folderColor === color.value ? "ring-2 ring-offset-2 ring-primary" : ""
                    }`}
                  >
                    <Folder className={`h-4 w-4 ${color.className}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseEditFolder}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateFolderMutation.mutate()}
              disabled={!folderName.trim() || updateFolderMutation.isPending}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Club Members and Admin Accordion */}
      <Accordion 
        type="multiple" 
        value={openSections}
        className="space-y-4"
        onValueChange={(value) => {
          setOpenSections(value);
          if (value.includes("members")) {
            setMembersExpanded(true);
            // Auto-refresh members list when expanding if empty
            if (Object.keys(clubMembers).length === 0 && !isMembersLoading && !isMembersFetching) {
              refetchClubMembers();
            }
          }
        }}
      >
        {/* Club Members Section - separate from Admin */}
        {isMember && (
          <AccordionItem value="members" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-start gap-2">
                <Users className="h-5 w-5 text-primary mt-1" />
                <div className="flex flex-col items-start">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">
                      👥 {clubMemberCount?.total ?? "—"} Members
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-normal">
                    {isMemberCountError && !clubMemberCount ? (
                      <span>Member numbers unavailable — pull to refresh</span>
                    ) : (
                      <>
                        <span>{isMemberCountLoading && !clubMemberCount ? "—" : clubMemberCount?.adults ?? 0} Adults</span>
                        <span>•</span>
                        <span>{isMemberCountLoading && !clubMemberCount ? "—" : clubMemberCount?.juniors ?? 0} Juniors</span>
                      </>
                    )}
                  </div>

                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <ClubMembersSection
                clubId={id!}
                clubName={club.name}
                isAdmin={isAdmin}
                clubMembers={clubMembers}
                isMembersLoading={isMembersLoading}
                isMembersError={isMembersError}
                membersError={membersError}
                onRetry={() => refetchClubMembers()}
                pendingInvites={pendingInvites}
                searchQuery={memberSearchQuery}
                onSearchQueryChange={(value) => {
                  setMemberSearchQuery(value);
                  setDisplayCount(MEMBERS_PER_PAGE);
                }}
                displayCount={displayCount}
                onShowMore={() => setDisplayCount(prev => prev + MEMBERS_PER_PAGE)}
              />
            </AccordionContent>
          </AccordionItem>
        )}

      {/* Sponsors — Admin only, hidden for class-mode clubs.
          Configuration is available on the free plan; display surfaces only
          light up once the club is on Pro (see the amber note + disabled toggles below). */}
      {isAdmin && !club?.class_mode_enabled && (() => {
        const hasProAccess = !!(isAppAdmin || clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override);
        const sponsorToggleInvalidateKeys: Record<ClubSponsorToggleField, readonly unknown[]> = {
          media_sponsors_enabled: ["riverside-media-sponsors-enabled"],
          media_header_sponsors_enabled: ["media-header-sponsors-enabled", id],
          chat_thread_ads_enabled: ["club-chat-thread-ads-enabled", id],
          events_sponsor_strip_enabled: ["events-sponsor-strip-allowed", id],
        };
        const sponsorToggleTitles: Record<ClubSponsorToggleField, { enabled: string; disabled: string }> = {
          media_sponsors_enabled: { enabled: "Media sponsors enabled", disabled: "Media sponsors disabled" },
          media_header_sponsors_enabled: { enabled: "Media header strip enabled", disabled: "Media header strip disabled" },
          chat_thread_ads_enabled: { enabled: "Chat sponsor strip enabled", disabled: "Chat sponsor strip disabled" },
          events_sponsor_strip_enabled: { enabled: "Events sponsor strip enabled", disabled: "Events sponsor strip disabled" },
        };
        const handleSponsorToggle = async (field: ClubSponsorToggleField, checked: boolean) => {
          const error = await withFeatureBackend("membership", {
            supabase: async () => {
              const { error } = await supabase
                .from("clubs")
                .update({ [field]: checked } as any)
                .eq("id", id!);
              return error;
            },
            icp: async (ctx) => {
              try {
                const { getLiveClubSettings, saveLiveClubSettings } = await import("@/live/features/club");
                const settingsOpt = await getLiveClubSettings(ctx, id!);
                const settings = settingsOpt[0];
                if (!settings) throw new Error("Club settings not found");
                await saveLiveClubSettings(ctx, { ...settings, [field]: checked });
                return null;
              } catch (e) {
                return e;
              }
            },
          });
          if (error) {
            toast({ title: "Error", description: "Failed to update setting.", variant: "destructive" });
            return;
          }
          await queryClient.invalidateQueries({ queryKey: ["club", id] });
          await queryClient.invalidateQueries({ queryKey: sponsorToggleInvalidateKeys[field] as unknown[] });
          const { enabled, disabled } = sponsorToggleTitles[field];
          toast({ title: checked ? enabled : disabled });
        };
        return (
          <ClubSponsorsSection
            hasProAccess={hasProAccess}
            toggleValues={{
              media_sponsors_enabled: !!(club as any)?.media_sponsors_enabled,
              media_header_sponsors_enabled: !!(club as any)?.media_header_sponsors_enabled,
              chat_thread_ads_enabled: !!(club as any)?.chat_thread_ads_enabled,
              events_sponsor_strip_enabled: !!(club as any)?.events_sponsor_strip_enabled,
            }}
            onToggle={handleSponsorToggle}
            clubId={id!}
            currentPrimarySponsorId={club?.primary_sponsor_id || null}
            onPrimaryChange={() => queryClient.invalidateQueries({ queryKey: ["club", id] })}
          />
        );
      })()}


      {/* Rewards - Pro only, Admin only */}
      {isAdmin && (
        <AccordionItem 
          value="rewards" 
          className="border rounded-lg px-4"
          disabled={!isAppAdmin && !(clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override)}
        >
          <AccordionTrigger 
            className="hover:no-underline"
            disabled={!isAppAdmin && !(clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override)}
          >
            <div className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Rewards</span>
              {!isAppAdmin && !(clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override) && (
                <div className="flex items-center gap-1.5 ml-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline" className="text-xs font-normal">Pro</Badge>
                </div>
              )}
            </div>
          </AccordionTrigger>
          {(isAppAdmin || clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override) && (
            <AccordionContent>
              <div className="pt-2">
                <ClubRewardsManager clubId={id!} />
              </div>
            </AccordionContent>
          )}
        </AccordionItem>
      )}

      {/* Messages - Admin only (combines DMs + Privacy + AI Catch Up) */}
      {isAdmin && (
        <AccordionItem value="messages-settings" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Messages</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-2 space-y-3">
              {(clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override) && (
                <ClubDMSettings clubId={id!} />
              )}
              <ClubMessagePrivacySettings clubId={id!} />
              <ClubAICatchUpSettings clubId={id!} />
              <ClubInviteEmailSettings clubId={id!} />
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Class Mode - Terms (Admin only) */}
      {isAdmin && club?.class_mode_enabled && (
        <AccordionItem value="terms" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Terms</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-2 space-y-4">
              <TermsManager clubId={id!} />
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Class Mode - Enrolments (Admin only) */}
      {isAdmin && club?.class_mode_enabled && (
        <ClubEnrolmentsSection
          clubId={id!}
          onShareLink={async () => {
            const url = `${window.location.origin}/clubs/${id}/enrol`;
            if (navigator.share) {
              try {
                await navigator.share({ title: `${club?.name} - Enrolment`, url });
              } catch {}
            } else {
              await navigator.clipboard.writeText(url);
              toast({ title: "Link copied!", description: "Enrolment link copied to clipboard." });
            }
          }}
        />

      )}

      {/* Class Mode - Attendance (Admin only) */}
      {isAdmin && club?.class_mode_enabled && (
        <AccordionItem value="attendance" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Attendance</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-2 space-y-6">
              <ClassAttendanceManager clubId={id!} />
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {isAdmin && id && (
        <ClubAdminNavigationSection
          clubId={id}
          isAppAdmin={isAppAdmin}
          subscription={clubSubscription}
        />
      )}

      {/* Club Info & Links — admins curate the tiles shown on Home */}
      {isAdmin && id && (
        <AccordionItem value="club-links" data-section-anchor="club-links" className="border rounded-lg px-4 scroll-mt-20">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Club Info & Links</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-2">
              <ClubLinksManager clubId={id} />
            </div>
          </AccordionContent>
        </AccordionItem>
      )}



      {/* Club Branding - configurable by all admins; colours only apply on Pro */}
      {isAdmin && (() => {
        const hasProAccess = !!(isAppAdmin || clubSubscription?.is_pro || clubSubscription?.is_pro_football || clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override);
        return (
          <ClubBrandingSection
            clubId={id!}
            hasProAccess={hasProAccess}
            clubLogoUrl={club.logo_url}
            initialPrimary={club.theme_primary_h !== null ? { h: club.theme_primary_h!, s: club.theme_primary_s!, l: club.theme_primary_l! } : undefined}
            initialSecondary={club.theme_secondary_h !== null ? { h: club.theme_secondary_h!, s: club.theme_secondary_s!, l: club.theme_secondary_l! } : undefined}
            initialAccent={club.theme_accent_h !== null ? { h: club.theme_accent_h!, s: club.theme_accent_s!, l: club.theme_accent_l! } : undefined}
            initialDarkPrimary={(club as any).theme_dark_primary_h !== null ? { h: (club as any).theme_dark_primary_h!, s: (club as any).theme_dark_primary_s!, l: (club as any).theme_dark_primary_l! } : undefined}
            initialDarkSecondary={(club as any).theme_dark_secondary_h !== null ? { h: (club as any).theme_dark_secondary_h!, s: (club as any).theme_dark_secondary_s!, l: (club as any).theme_dark_secondary_l! } : undefined}
            initialDarkAccent={(club as any).theme_dark_accent_h !== null ? { h: (club as any).theme_dark_accent_h!, s: (club as any).theme_dark_accent_s!, l: (club as any).theme_dark_accent_l! } : undefined}
            initialShowLogoInHeader={club.show_logo_in_header}
            initialShowNameInHeader={(club as any).show_name_in_header ?? true}
            initialLogoOnlyMode={(club as any).logo_only_mode ?? false}
            initialThemeEnabled={(club as any).theme_enabled ?? true}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["club", id] });
              queryClient.invalidateQueries({ queryKey: ["club-themes"] });
            }}
          />
        );
      })()}

      {/* Schedule tools — tucked away; bulk fixture import is rarely used */}
      {canImportFixtures && (() => {
        const hasImportProAccess = !!(
          isAppAdmin
          || clubSubscription?.is_pro
          || clubSubscription?.is_pro_football
          || clubSubscription?.admin_pro_override
          || clubSubscription?.admin_pro_football_override
        );
        return (
          <ClubScheduleToolsSection
            hasImportProAccess={hasImportProAccess}
            onUpgradeClick={() => {
              toast({
                title: "Pro feature",
                description: "Import Fixtures is available on Pro. Contact your club administrator to upgrade.",
              });
              navigate(`/clubs/${id}/upgrade`);
            }}
          />
        );
      })()}

      {/* App Admin Section */}

      {isAppAdmin && (
        <ClubAppAdminSection
          isPro={clubSubscription?.is_pro || false}
          isProFootball={clubSubscription?.is_pro_football || false}
          isSoccerClub={isSoccerClub}
          isTogglePending={toggleClubProMutation.isPending}
          plan={clubSubscription?.plan}
          teamLimit={clubSubscription?.team_limit}
          onToggleClubPro={handleToggleClubPro}
          onToggleClubProFootball={handleToggleClubProFootball}
        />
      )}
      </Accordion>

      {/* Standalone delete folder confirmation dialog */}
      <AlertDialog open={!!deletingFolder} onOpenChange={(open) => !open && setDeletingFolder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the folder "{deletingFolder?.name}". Teams in this folder will become uncategorized.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingFolder) deleteFolderMutation.mutate(deletingFolder.id);
                setDeletingFolder(null);
              }}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isAdmin && club && teams && user && (
        <ClubAnnouncementDialog
          open={announcementDialogOpen}
          onOpenChange={setAnnouncementDialogOpen}
          clubName={club.name}
          clubId={club.id}
          teams={teams}
          userId={user.id}
        />
      )}
      {moveToTeam && id && (
        <MoveToTeamSheet
          open={!!moveToTeam}
          onOpenChange={(open) => { if (!open) setMoveToTeam(null); }}
          clubId={id}
          fromTeamId={moveToTeam.fromTeamId}
          fromTeamName={moveToTeam.fromTeamName}
          memberType="adult"
          memberId={moveToTeam.userId}
          memberName={moveToTeam.userName}
          memberRoles={moveToTeam.roles}
        />
      )}

    </div>
  );
}
