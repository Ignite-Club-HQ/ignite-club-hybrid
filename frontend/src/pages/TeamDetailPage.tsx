import { useState, useEffect, useRef, Suspense, useMemo, type ReactNode } from "react";
import { prefetchProfiles } from "@/hooks/useProfiles";
import { cacheProfiles, getProfileFromCache, selectCachedProfileById, selectCachedProfilesByIds } from "@/lib/profileCache";
import { invalidateTeamLists } from "@/lib/invalidateTeamLists";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Users, Calendar, MessageCircle, Settings, Trash2, UserPlus, Loader2, Crown, Pencil, LayoutGrid, Plus, RefreshCw, CreditCard, Flame, Building2, Lock, FolderOpen, BarChart3, Archive, ArchiveRestore, ClipboardCheck, Copy, ChevronRight, ArrowRightLeft, Trophy, Eye, Radio, MoreVertical, Image as ImageIcon, FileText } from "lucide-react";
import { TeamNextEventCard } from "@/components/team/TeamNextEventCard";
import { TeamRankCard } from "@/components/team/TeamRankCard";
import { TeamNextStepsCard } from "@/components/team/TeamNextStepsCard";
import { TeamLatestPhotos } from "@/components/team/TeamLatestPhotos";
import { ArchiveTeamDialog } from "@/components/ArchiveTeamDialog";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SwipeableCard } from "@/components/ui/swipeable-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { markTeamDeleted, unmarkTeamDeleted } from "@/lib/deletedTeamTombstones";
import { removeTeamFromMessagesPageCache } from "@/lib/messagesPageCache";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { eventKeys } from "@/lab/eventQueryKeys";
const PitchBoard = lazyWithRetry(() => import("@/components/pitch/PitchBoard"));
// NetballBoard / BasketballBoard archived — football-only build (see archive/sports/)
const TeamGameHistoryTab = lazyWithRetry(() => import("@/components/history/TeamGameHistoryTab"));
import { isNetballSport, isBasketballSport } from "@/lib/sportDetection";
import {
  clearPitchBoardOpenFlag,
  shouldRestorePitchBoardForCurrentPath,
} from "@/components/pitch/pitchBoardOpenFlag";
import { DefaultPitchSettings } from "@/components/pitch/DefaultPitchSettings";
import ChatGroupsList from "@/components/chat/ChatGroupsList";
const AddTeamMemberSheet = lazyWithRetry(() => import("@/components/AddTeamMemberSheet"));
const InviteOtherParentSheet = lazyWithRetry(() => import("@/components/InviteOtherParentSheet"));
const AddPlayerToParentSheet = lazyWithRetry(() => import("@/components/team/AddPlayerToParentSheet"));
const MemberDetailSheet = lazyWithRetry(() => import("@/components/MemberDetailSheet"));
import LinkChildToParentSheet from "@/components/LinkChildToParentSheet";
import { TeamAdminInviteDialog } from "@/components/TeamAdminInviteDialog";
import TeamPlayerPositionEditor from "@/components/TeamPlayerPositionEditor";
import PlayerPositionSheet from "@/components/PlayerPositionSheet";
import AddRoleToMemberDialog from "@/components/AddRoleToMemberDialog";
import ChildDetailSheet from "@/components/ChildDetailSheet";

import { MoveToTeamSheet } from "@/components/MoveToTeamSheet";
import { getSportEmoji } from "@/lib/sportEmojis";
import { findNearbyGameEvent } from "@/hooks/useNearbyGameEvent";
import MemberSubscriptionPaymentsManager from "@/components/MemberSubscriptionPaymentsManager";
import { PrimarySponsorDisplay } from "@/components/PrimarySponsorDisplay";
import { TeamSponsorSelector } from "@/components/TeamSponsorSelector";
import PendingInvitesList from "@/components/PendingInvitesList";

import TeamRewardsManager from "@/components/TeamRewardsManager";
import { ClassAttendanceSingle } from "@/components/ClassAttendanceSingle";
import { cn } from "@/lib/utils";
import { defaultMinutesPerHalfForTeamName } from "@/lib/teamAgeDefaults";
import { buildTeamPitchSettingsPayload, type TeamPitchSettingsOverrides } from "@/lib/teamPitchSettingsPayload";
import { computeAppAdminOverride, type TeamAppAdminOverrideChange } from "@/lib/teamAppAdminOverridePayload";
import TeamCompetitionsSection from "@/components/competitions/TeamCompetitionsSection";
import { friendlyQueryError, friendlyQueryErrorMessage } from "@/lib/friendlyQueryError";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  softDeleteLiveTeam,
  restoreLiveTeam,
  deleteLiveTeamPermanent,
  removeLiveMember,
  requestLiveRole,
  getLiveMyRoleGrants,
  listLiveTeamRoleGrants,
} from "@/live/features/membership";
import { getLiveTeam, getLiveClubProfile, getLiveClubSubscription, getLiveTeamSubscription, saveLiveTeamSubscription, saveLiveTeamPitchSettings } from "@/live/features/club";
import { listLiveProfilesByIds, accountIdForPrincipal } from "@/live/features/identityAccessClient";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { Principal } from "@icp-sdk/core/principal";
import * as fixtureData from "@/lab/fixtureDataLayer";
import { membershipKeys } from "@/lab/membershipQueryKeys";
import {
  refreshAfterLeavingTeam,
  refreshRemovedTeamChild,
  refreshRemovedTeamMember,
  refreshTeamRoleChange,
} from "@/lab/teamMembershipCacheCompletion";
import {
  TeamJoinRequestCard,
  type TeamJoinRole,
} from "@/components/team/TeamJoinRequestCard";
import {
  RemoveTeamChildDialog,
  RemoveTeamMemberDialog,
} from "@/components/team/TeamRemoveMemberDialogs";
import { TeamMembersSection } from "@/components/team/TeamMembersSection";
import { TeamAdminAccordionSection, TeamAppAdminAccordionSection } from "@/components/team/TeamAdminAccordionSections";
import { ProLockedAccordionSection } from "@/components/team/ProLockedAccordionSection";
import { TeamLeaveDialog } from "@/components/team/TeamLeaveDialog";
import { TeamQuickActionsSection } from "@/components/team/TeamQuickActionsSection";
import { TeamDetailAccordionSections } from "@/components/team/TeamDetailAccordionSections";
import { getCachedTeam, getCachedClub, cacheTeam, cacheClub } from "@/lib/clubTeamCache";


type TeamRole = TeamJoinRole;

const SOCCER_SPORTS = ["soccer", "football", "futsal"];
const normalizeDutyName = (name: string | null | undefined) => name?.trim().toLowerCase() ?? "";

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, profile: myProfile } = useAuth();
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  // Team lifecycle management (delete/restore/permanent-delete/role-removal/join-request)
  // has no club_domain canister shape yet, so these actions are gated off entirely
  // in ICP mode rather than falling through to Supabase against a principal id.
  const isIcpAccount = resolveAuthBackend() === "icp";
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [memberRoleFilter, setMemberRoleFilter] = useState<string>("all");
  const [headerInviteOpen, setHeaderInviteOpen] = useState(false);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [hasSetInitialFilter, setHasSetInitialFilter] = useState(false);
  
  const [selectedRole, setSelectedRole] = useState<TeamRole>("player");
  const [selectedChildForLink, setSelectedChildForLink] = useState<string>("");
  const [newChildName, setNewChildName] = useState<string>("");
  const [showPitchBoard, setShowPitchBoard] = useState(false);
  const [linkedEventId, setLinkedEventId] = useState<string | null>(null);
  const [pitchBoardMembersOverride, setPitchBoardMembersOverride] = useState<Array<{ id: string; user_id: string; role: string; profiles: { display_name: string | null; avatar_url: string | null } | null }>>([]);
  const [isSavingPitchSettings, setIsSavingPitchSettings] = useState(false);
  
  // Long-press position editor state
  const [positionSheetPlayer, setPositionSheetPlayer] = useState<{ id: string; name: string; type: "member" | "child" } | null>(null);
  const [inviteParentChild, setInviteParentChild] = useState<{ childId: string; childName: string } | null>(null);
  const [linkChildToParent, setLinkChildToParent] = useState<{ childName: string; existingChildId?: string; pendingInviteIds: string[] } | null>(null);
  const [moveToTeam, setMoveToTeam] = useState<{ type: "adult" | "child"; id: string; name: string; roles?: string[] } | null>(null);
  const [addRoleMember, setAddRoleMember] = useState<{ userId: string; userName: string; existingRoles: string[] } | null>(null);
  const [removeMember, setRemoveMember] = useState<{ userId: string; name: string } | null>(null);
  const [removeChild, setRemoveChild] = useState<{ childId: string; name: string } | null>(null);
  const [removeChildConfirmText, setRemoveChildConfirmText] = useState("");
  const [selectedMember, setSelectedMember] = useState<{ userId: string; displayName: string; avatarUrl?: string | null; roles: { id: string; role: string }[] } | null>(null);
  const [selectedChild, setSelectedChild] = useState<{ childId: string; childName: string; parentDisplay: string | null; isPending: boolean; linkInviteIds?: string[] } | null>(null);
  
  // Handle admin invite dialog from team creation flow
  const locationState = location.state as { showAdminInvite?: boolean; inviteName?: string; inviteEmail?: string; teamName?: string } | null;
  const [showAdminInviteDialog, setShowAdminInviteDialog] = useState(!!locationState?.showAdminInvite);
  const adminInviteName = locationState?.inviteName || "";
  const adminInviteEmail = locationState?.inviteEmail || "";
  const adminInviteTeamName = locationState?.teamName || "";

  const { data: team, isLoading, fetchStatus: teamFetchStatus } = useQuery({
    queryKey: ["team", id],
    queryFn: async () => {
      if (isFeatureRoutedToIcp("membership") && id) {
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const row = await getLiveTeam(ctx, id);
            const t = row.length ? row[0] : null;
            if (!t) return null;
            const [profileRow, sub] = await Promise.all([
              getLiveClubProfile(ctx, t.club_id),
              getLiveClubSubscription(ctx, t.club_id),
            ]);
            const club = profileRow.length ? profileRow[0] : null;
            // Map the canister team + club onto the Supabase row shape this
            // page renders (including the clubs join).
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
              folder_id: t.folder_id[0] ?? null,
              is_pro: sub?.is_pro ?? false,
              // Supabase-only columns with no canister equivalent.
              class_day: null,
              sponsor_id: null,
              deleted_at: t.deleted_at_ms.length
                ? new Date(Number(t.deleted_at_ms[0])).toISOString()
                : null,
              clubs: club
                ? {
                    id: club.id,
                    name: club.name,
                    is_pro: sub?.is_pro ?? false,
                    sport: club.sport[0] ?? null,
                    class_mode_enabled: false,
                    bot_user_id: null,
                  }
                : null,
            };
          },
        });
      }

      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs!club_id (id, name, is_pro, sport, class_mode_enabled, bot_user_id)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
    // Open instantly from the saved team/club name while the full record loads.
    placeholderData: () => {
      const t = id ? getCachedTeam(id) : null;
      if (!t) return undefined;
      const c = getCachedClub(t.club_id);
      return {
        id: t.id, club_id: t.club_id, name: t.name, logo_url: t.logo_url, team_type: t.team_type ?? null,
        division: null, gender: null, age_group: t.level_age, description: null, is_active: true,
        is_archived: false, is_shell: false, folder_id: null, is_pro: c?.is_pro ?? false,
        class_day: null, sponsor_id: null, deleted_at: null,
        clubs: c ? { id: c.id, name: c.name, is_pro: c.is_pro, sport: c.sport, class_mode_enabled: false, bot_user_id: null } : null,
      } as any;
    },
  });
  useEffect(() => {
    if (team?.id && team.name && team.club_id) {
      cacheTeam({ id: team.id, name: team.name, logo_url: team.logo_url ?? null, club_id: team.club_id, level_age: (team as any).age_group ?? null, team_type: (team as any).team_type ?? undefined });
      const c = (team as any).clubs;
      if (c?.id) cacheClub({ id: c.id, name: c.name, logo_url: getCachedClub(c.id)?.logo_url ?? null, sport: c.sport ?? null, is_pro: !!c.is_pro });
    }
  }, [team?.id, team?.name, team?.club_id]);
  const teamQueryPaused = teamFetchStatus === "paused";

  const isSoccerClub = team?.clubs?.sport && SOCCER_SPORTS.some(keyword => 
    team.clubs.sport.toLowerCase().includes(keyword)
  );
  const isNetballClub = isNetballSport(team?.clubs?.sport);
  const isBasketballClub = isBasketballSport(team?.clubs?.sport);

  const isClassMode = !!team?.clubs?.class_mode_enabled;

  // Default to "child" filter only when arriving from an invite link for junior teams
  useEffect(() => {
    if (team && !hasSetInitialFilter) {
      const tType = (team as any).team_type || "mixed";
      const fromInvite = new URLSearchParams(window.location.search).get("from") === "invite";
      if (tType === "junior" && fromInvite) {
        setMemberRoleFilter("child");
      }
      setHasSetInitialFilter(true);
    }
  }, [team, hasSetInitialFilter]);

  // Auto-open the game board when arriving from a "Resume game" tap
  // (CourtBoardResumeCard / GameTimerWidget on the home screen).
  // Depend on location.search so a warm-resume restore from
  // PitchBoardResumeRedirect (which appends ?openPitchBoard=1 via replace
  // navigation while this page is already mounted) re-triggers the effect.
  useEffect(() => {
    if (!team) return;
    const params = new URLSearchParams(window.location.search);
    // Accept both `openBoard=1` (CourtBoardResumeCard / GameTimerWidget) and
    // `openPitchBoard=1` (PitchBoardResumeRedirect cold-start recovery) so a
    // restored team-scoped pitch board reopens regardless of entry point.
    if (
      params.get("openBoard") === "1" ||
      params.get("openPitchBoard") === "1" ||
      shouldRestorePitchBoardForCurrentPath(window.location.pathname)
    ) {
      setShowPitchBoard(true);
      // Strip the param so a refresh doesn't re-open after the coach closed it.
      params.delete("openBoard");
      params.delete("openPitchBoard");
      const next = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${next ? `?${next}` : ""}`
      );
    }
  }, [team, location.search]);


  // Check if user (or their children) is already enrolled in this class
  const { data: isEnrolledInClass } = useQuery({
    queryKey: ["class-enrolment-check", id, user?.id],
    queryFn: async () => {
      if (useIcpLab) return false;

      const { data, error } = await supabase
        .from("class_enrolments")
        .select("id")
        .eq("team_id", id!)
        .neq("status", "withdrawn")
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    enabled: !!id && !!user && isClassMode && !useIcpLab,
  });

  const { data: teamSubscription } = useQuery({
    queryKey: ["team-subscription", id],
    queryFn: async () => {
      if (useIcpLab && id) {
        return {
          team_id: id,
          is_pro: false,
          is_pro_football: false,
          trial_ends_at: null,
          is_trial: false,
          cancelled_at: null,
          disable_auto_subs: false,
          rotation_speed: 1,
          team_size: 7,
          formation: null,
          minutes_per_half: 45,
          disable_position_swaps: false,
          admin_pro_override: false,
          admin_pro_football_override: false,
          disable_batch_subs: false,
          rotate_gk_at_halftime: true,
          show_lineup_picker: false,
        };
      }

      if (isFeatureRoutedToIcp("membership") && id) {
        // Live ICP: team_subscriptions rows live on club_domain; Supabase
        // has no rows for II accounts, so this would always come back empty
        // (and Pro gates would never lift after an app-admin grant).
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const sub = await getLiveTeamSubscription(ctx, id);
            if (!sub) return null;
            return {
              team_id: sub.team_id,
              is_pro: sub.is_pro,
              is_pro_football: sub.is_pro_football,
              is_trial: sub.is_trial,
              trial_ends_at: sub.trial_ends_at_ms.length ? new Date(Number(sub.trial_ends_at_ms[0])).toISOString() : null,
              cancelled_at: sub.cancelled_at_ms.length ? new Date(Number(sub.cancelled_at_ms[0])).toISOString() : null,
              disable_auto_subs: sub.disable_auto_subs,
              rotation_speed: Number(sub.rotation_speed),
              disable_position_swaps: sub.disable_position_swaps,
              disable_batch_subs: sub.disable_batch_subs,
              rotate_gk_at_halftime: sub.rotate_gk_at_halftime,
              minutes_per_half: sub.minutes_per_half.length ? Number(sub.minutes_per_half[0]) : null,
              max_spread_minutes: sub.max_spread_minutes.length ? Number(sub.max_spread_minutes[0]) : null,
              team_size: sub.team_size.length ? Number(sub.team_size[0]) : null,
              formation: sub.formation.length ? sub.formation[0] : null,
              show_lineup_picker: sub.show_lineup_picker,
              disable_team_pom_rewards: sub.disable_team_pom_rewards,
              admin_pro_override: sub.admin_pro_override,
              admin_pro_football_override: sub.admin_pro_football_override,
            };
          },
        });
      }

      const { data, error } = await supabase
        .from("team_subscriptions")
        .select("*")
        .eq("team_id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  /**
   * Persists a single Pitch Settings field change. Builds the full upsert
   * payload from the current `teamSubscription` row plus the given
   * overrides (so untouched fields are preserved), then invalidates the
   * subscription cache and toasts the result.
   */
  const savePitchSetting = async (
    overrides: TeamPitchSettingsOverrides,
    failureTitle: string,
    successTitle: string,
  ) => {
    setIsSavingPitchSettings(true);
    if (isFeatureRoutedToIcp("membership")) {
      // Live ICP: team_subscriptions rows live on club_domain; pitch fields
      // merge canister-side and never touch the Pro flags.
      try {
        const payload = buildTeamPitchSettingsPayload(
          id!,
          teamSubscription,
          defaultMinutesPerHalfForTeamName(team?.name),
          overrides,
        );
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            await saveLiveTeamPitchSettings(ctx, id!, {
              disable_auto_subs: payload.disable_auto_subs,
              rotation_speed: payload.rotation_speed,
              disable_position_swaps: payload.disable_position_swaps,
              disable_batch_subs: (teamSubscription as any)?.disable_batch_subs ?? false,
              rotate_gk_at_halftime: (teamSubscription as any)?.rotate_gk_at_halftime ?? true,
              minutes_per_half: payload.minutes_per_half,
              max_spread_minutes: (teamSubscription as any)?.max_spread_minutes ?? null,
              team_size: payload.team_size,
              formation: payload.formation,
              show_lineup_picker: (teamSubscription as any)?.show_lineup_picker ?? false,
              disable_team_pom_rewards: (teamSubscription as any)?.disable_team_pom_rewards ?? false,
            });
          },
        });
      } catch {
        setIsSavingPitchSettings(false);
        toast({ title: failureTitle, variant: "destructive" });
        return;
      }
      setIsSavingPitchSettings(false);
      queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
      toast({ title: successTitle });
      return;
    }
    const { error } = await supabase
      .from("team_subscriptions")
      .upsert(
        buildTeamPitchSettingsPayload(
          id!,
          teamSubscription,
          defaultMinutesPerHalfForTeamName(team?.name),
          overrides,
        ),
        { onConflict: "team_id" },
      );
    setIsSavingPitchSettings(false);
    if (error) {
      toast({ title: failureTitle, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
      toast({ title: successTitle });
    }
  };

  /**
   * Persists an App Admin Pro/Pro Football access override change. The two
   * fields cascade — see `computeAppAdminOverride` for the exact rules.
   */
  const saveAppAdminOverride = async (change: TeamAppAdminOverrideChange) => {
    const { adminProOverride, adminProFootballOverride } = computeAppAdminOverride(change, teamSubscription as any);

    if (isFeatureRoutedToIcp("membership")) {
      // Live ICP: the override row lives on club_domain; the write is
      // app-admin gated canister-side, mirroring the Supabase RLS policy.
      try {
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const existing = await getLiveTeamSubscription(ctx, id!);
            await saveLiveTeamSubscription(ctx, {
              team_id: id!,
              is_pro: existing?.is_pro ?? false,
              is_pro_football: existing?.is_pro_football ?? false,
              is_trial: existing?.is_trial ?? false,
              trial_ends_at_ms: existing?.trial_ends_at_ms ?? [],
              cancelled_at_ms: existing?.cancelled_at_ms ?? [],
              admin_pro_override: adminProOverride,
              admin_pro_football_override: adminProFootballOverride,
              disable_auto_subs: existing?.disable_auto_subs ?? false,
              rotation_speed: existing?.rotation_speed ?? 1,
              disable_position_swaps: existing?.disable_position_swaps ?? false,
              disable_batch_subs: existing?.disable_batch_subs ?? false,
              rotate_gk_at_halftime: existing?.rotate_gk_at_halftime ?? true,
              minutes_per_half: existing?.minutes_per_half ?? [],
              max_spread_minutes: existing?.max_spread_minutes ?? [],
              team_size: existing?.team_size ?? [],
              formation: existing?.formation ?? [],
              show_lineup_picker: existing?.show_lineup_picker ?? false,
              disable_team_pom_rewards: existing?.disable_team_pom_rewards ?? false,
            });
          },
        });
      } catch {
        toast({ title: "Failed to update", variant: "destructive" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
      toast({
        title: "admin_pro_override" in change
          ? change.admin_pro_override ? "Free Pro access granted" : "Free Pro access removed"
          : change.admin_pro_football_override ? "Free Pro Football access granted" : "Free Pro Football access removed",
      });
      return;
    }

    const { error } = await supabase
      .from("team_subscriptions")
      .upsert({
        team_id: id!,
        admin_pro_override: adminProOverride,
        admin_pro_football_override: adminProFootballOverride,
        is_pro: teamSubscription?.is_pro || false,
        is_pro_football: teamSubscription?.is_pro_football || false,
        disable_auto_subs: teamSubscription?.disable_auto_subs || false,
        rotation_speed: teamSubscription?.rotation_speed || 1,
      }, { onConflict: "team_id" });
    if (error) {
      toast({ title: "Failed to update", variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["team-subscription", id] });
    toast({
      title: "admin_pro_override" in change
        ? change.admin_pro_override ? "Free Pro access granted" : "Free Pro access removed"
        : change.admin_pro_football_override ? "Free Pro Football access granted" : "Free Pro Football access removed",
    });
  };

  const { data: clubSubscription, isLoading: isClubSubscriptionLoading, isFetching: isClubSubscriptionFetching } = useQuery({
    queryKey: ["club-subscription", team?.club_id],
    queryFn: async () => {
      if (useIcpLab && team?.club_id) {
        return {
          club_id: team.club_id,
          is_pro: false,
          is_pro_football: false,
          is_trial: false,
          cancelled_at: null,
          disable_auto_subs: false,
          rotation_speed: 1,
          admin_pro_override: false,
          admin_pro_football_override: false,
          trial_ends_at: null,
          disable_team_pom_rewards: false,
        };
      }

      if (isFeatureRoutedToIcp("membership") && team?.club_id) {
        // Live ICP: club_subscriptions rows live on club_domain; Supabase
        // returns nothing for II accounts, so club-level Pro would never
        // reach this page.
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const sub = await getLiveClubSubscription(ctx, team!.club_id);
            if (!sub) return null;
            return {
              club_id: sub.club_id,
              is_pro: sub.is_pro,
              is_pro_football: sub.is_pro_football,
              is_trial: sub.is_trial,
              cancelled_at: sub.cancelled_at_ms.length ? new Date(Number(sub.cancelled_at_ms[0])).toISOString() : null,
              disable_auto_subs: false,
              rotation_speed: 1,
              admin_pro_override: sub.admin_pro_override,
              admin_pro_football_override: sub.admin_pro_football_override,
              trial_ends_at: sub.trial_ends_at_ms.length ? new Date(Number(sub.trial_ends_at_ms[0])).toISOString() : null,
              disable_team_pom_rewards: false,
            };
          },
        });
      }

      const { data, error } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", team!.club_id)
        .maybeSingle();
      if (error) throw friendlyQueryError(error, "this club's subscription details");
      return data;
    },
    enabled: !!team?.club_id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes to prevent unnecessary refetches
  });

  // Check if user is club admin for this team's club (needed for isSubscriptionLoading calculation)
  const { data: isClubAdmin, isLoading: isClubAdminLoading, isFetching: isClubAdminFetching } = useQuery({
    queryKey: ["is-club-admin", user?.id, team?.club_id],
    queryFn: async () => {
      if (isFeatureRoutedToIcp("membership")) {
        // Live ICP: role grants live on club_domain; Supabase user_roles has
        // no rows for Internet Identity accounts, so this query would always
        // come back false (and the team page would offer "Request to Join"
        // to the club's own creator).
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const grants = await getLiveMyRoleGrants(ctx);
            return grants.some((g) => g.role === "club_admin" && (g.club?.[0] ?? null) === team!.club_id);
          },
        });
      }
      const { data, error } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("club_id", team!.club_id)
        .eq("role", "club_admin")
        .maybeSingle();
      if (error) throw friendlyQueryError(error, "your club admin permissions");
      return !!data;
    },
    enabled: !!user && !!team?.club_id && !useIcpLab,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });


  // Note: team folders query and mutation removed - "Move to Folder" no longer in this page

  // Track if subscription data is still loading - don't show Pro lock while loading OR refetching
  // Must wait for:
  // 1. Team to load (so we know if it has a club_id)
  // 2. Club subscription to load/refetch (if team has a club_id)
  // 3. Club admin check to load/refetch (affects whether we show admin features)
  // Using isFetching catches both initial load AND background refetches
  const isSubscriptionLoading = isLoading || (!!team?.club_id && (isClubSubscriptionLoading || isClubAdminLoading || isClubSubscriptionFetching || isClubAdminFetching));

  // Pro Access Logic:
  // 1. If club has Pro → ALL teams inherit Pro (clubSubscription takes precedence)
  // 2. If club does NOT have Pro → check team's individual subscription
  const clubHasPro = clubSubscription?.is_pro || clubSubscription?.is_pro_football || 
                     clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override;
  
  const teamHasIndividualPro = teamSubscription?.is_pro || teamSubscription?.is_pro_football ||
                                (teamSubscription as any)?.admin_pro_override || (teamSubscription as any)?.admin_pro_football_override ||
                                team?.is_pro;
  
  // Team has Pro if: club has Pro (inherited) OR (club is free AND team has individual Pro)
  // IMPORTANT: During loading, assume Pro access (optimistic) to avoid flashing Pro locks
  const isTeamPro = isSubscriptionLoading ? true : (clubHasPro || (!clubHasPro && teamHasIndividualPro));
  
  const clubHasProFootball = clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override;
  const teamHasIndividualProFootball = teamSubscription?.is_pro_football || (teamSubscription as any)?.admin_pro_football_override;
  // During loading, assume Pro access to avoid flashing Pro locks
  const hasProFootball = isSubscriptionLoading ? true : (clubHasProFootball || (!clubHasProFootball && teamHasIndividualProFootball));

  // Trial detection: team is on trial if subscription says so OR if team.is_pro with pro_expires_at (website signup)
  const isOnTrial = !!(
    teamSubscription?.is_trial ||
    clubSubscription?.is_trial ||
    (team?.is_pro && (team as any)?.pro_expires_at)
  );

  // Note: refetchOnMount: 'always' on the queries ensures fresh data
  // without clearing the cache (which would cause a flash of empty state)

  // Fetch children assigned to the team
  const { data: teamChildren = [], isLoading: isChildrenLoading, isFetching: isChildrenFetching, refetch: refetchChildren } = useQuery({
    queryKey: membershipKeys.teamChildren(id),
    queryFn: async () => {
      const { data: rpcChildren, error: rpcError } = await supabase.rpc("get_team_children_for_pitch_board", {
        p_team_id: id!,
      });
      if (rpcError) throw rpcError;

      const childrenRows = rpcChildren || [];
      if (childrenRows.length === 0) return [];

      const childIds = childrenRows.map((row) => row.child_id);

      // Guardians are club-scoped: a parent linked to this child at ANOTHER club
      // must never surface on this club's roster.
      const { data: teamRow } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", id!)
        .maybeSingle();
      const { data: guardianLinks } = teamRow?.club_id
        ? await supabase.rpc("club_scoped_child_guardians", {
            p_child_ids: childIds,
            p_club_id: teamRow.club_id,
          })
        : { data: [] as { child_id: string; guardian_id: string }[] };


      const parentIds = [...new Set([
        ...childrenRows.map((c) => c.parent_id).filter(Boolean),
        ...(guardianLinks || []).map((g) => g.guardian_id).filter(Boolean),
      ])];

      let parentProfiles: Record<string, { id: string; display_name: string | null }> = {};
      if (parentIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(parentIds);
        parentProfiles = (profiles || []).reduce((acc, p) => {
          acc[p.id] = p;
          return acc;
        }, {} as Record<string, { id: string; display_name: string | null }>);
      }

      const guardiansByChild: Record<string, string[]> = {};
      for (const link of (guardianLinks || [])) {
        if (!guardiansByChild[link.child_id]) guardiansByChild[link.child_id] = [];
        guardiansByChild[link.child_id].push(link.guardian_id);
      }

      return childrenRows.map((child) => {
        const allParentNames: string[] = [];
        if (child.parent_id && parentProfiles[child.parent_id]?.display_name) {
          allParentNames.push(parentProfiles[child.parent_id].display_name!);
        }
        for (const gId of (guardiansByChild[child.child_id] || [])) {
          if (gId !== child.parent_id && parentProfiles[gId]?.display_name) {
            allParentNames.push(parentProfiles[gId].display_name!);
          }
        }

        return {
          id: child.assignment_id,
          child_id: child.child_id,
          children: {
            id: child.child_id,
            name: child.child_name,
            year_of_birth: child.year_of_birth,
            parent_id: child.parent_id,
            profiles: child.parent_id ? parentProfiles[child.parent_id] : null,
            allParentNames,
          },
        };
      });
    },
    enabled: !!id && !useIcpLab,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  // Fetch roles data with profiles - with caching for faster loads
  const { data: rawMembersData = [], isLoading: isMembersLoading, isFetching: isMembersFetching, isError: isMembersError, error: membersError, refetch: refetchMembers } = useQuery({
    queryKey: membershipKeys.teamRoles(id),
    queryFn: async () => {
      if (isFeatureRoutedToIcp("membership")) {
        // Live ICP: the member list comes from club_domain role grants, not
        // Supabase user_roles (which has no rows for II accounts).
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            let grants: Array<{ account_id: string; role: string }>;
            try {
              grants = await listLiveTeamRoleGrants(ctx, id!);
            } catch {
              // Pre-deploy canisters lack list_team_role_grants; fall back to
              // the caller's own grants so they at least see themselves.
              grants = (await getLiveMyRoleGrants(ctx))
                .filter((g) => (g.team?.[0] ?? null) === id!)
                .map((g) => ({ account_id: g.user.toText(), role: g.role }));
            }
            const accountIds = [...new Set(grants.map((g) => g.account_id))];
            const profiles = accountIds.length > 0
              ? await listLiveProfilesByIds(ctx, accountIds).catch(() => [])
              : [];
            const profileMap = new Map(profiles.map((p: any) => [p.account_id, p]));
            // The signed-in member's own name is always known locally — use it
            // when identity_access has no (named) profile row for their id.
            const selfIds = new Set<string>([user?.id, user?.id ? `principal:${user.id}` : null, (myProfile as any)?.id].filter(Boolean) as string[]);
            if (user?.id) { const a = await accountIdForPrincipal(user.id); if (a) selfIds.add(a); }
            return grants.map((g) => {
              let p: any = profileMap.get(g.account_id);
              if ((!p || !p.display_name) && selfIds.has(g.account_id) && myProfile?.display_name) {
                p = { ...(p ?? {}), display_name: myProfile.display_name, avatar_ref: p?.avatar_ref ?? [(myProfile as any).avatar_url].filter(Boolean) };
              }
              return {
                id: `${g.account_id}:${g.role}`,
                user_id: g.account_id,
                role: g.role,
                profiles: p
                  ? { id: g.account_id, display_name: p.display_name, avatar_url: p.avatar_ref?.[0] ?? null }
                  : null,
              };
            });
          },
        });
      }
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, user_id, role, profiles (id, display_name, avatar_url)")
        .eq("team_id", id!);
      if (error) throw friendlyQueryError(error, "the team member list");
      
      // Cache profiles for faster future loads
      if (data) {
        const profiles = data
          .filter(r => r.profiles)
          .map(r => ({
            id: r.profiles!.id,
            display_name: r.profiles!.display_name,
            avatar_url: r.profiles!.avatar_url,
          }));
        if (profiles.length > 0) {
          cacheProfiles(profiles);
        }
      }
      
      return data || [];
    },
    enabled: !!id && !useIcpLab,
    staleTime: 0, // Always fetch fresh data
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnMount: 'always', // Always refetch when component mounts
    refetchOnWindowFocus: false,
  });

  // Group roles by user - use user_id directly since it's always present
  // Memoize to prevent recalculation on every render
  const members = useMemo(() => {
    if (!rawMembers || rawMembers.length === 0) {
      return {};
    }
    
    // Filter out club bot account from member list
    const botUserId = team?.clubs?.bot_user_id;
    
    return rawMembers.reduce((acc, role) => {
      // user_id should always be present in user_roles table
      const userId = role.user_id;
      if (!userId || userId === botUserId) return acc;
      
      if (!acc[userId]) {
        // Try to get cached profile data for faster initial render
        const cachedProfile = getProfileFromCache(userId);
        acc[userId] = {
          profile: role.profiles || (cachedProfile ? {
            id: userId,
            display_name: cachedProfile.display_name,
            avatar_url: cachedProfile.avatar_url,
          } : { id: userId, display_name: null, avatar_url: null }),
          roles: [],
        };
      }
      acc[userId].roles.push({ id: role.id, role: role.role });
      return acc;
    }, {} as Record<string, { profile: any; roles: { id: string; role: string }[] }>);
  }, [rawMembers, team?.clubs?.bot_user_id]);

  /**
   * Adult members whose primary role is "player". Used purely for presentation:
   * child players and adult players are shown under one combined "Players (N)"
   * heading so the roster reads as a single squad list.
   */
  const adultPlayerCount = useMemo(() => {
    const priority = ["player", "parent", "coach", "team_admin", "club_admin", "app_admin", "basic_user"];
    let count = 0;
    for (const member of Object.values(members) as Array<{ roles: { role: string }[] }>) {
      let primaryRole = "basic_user";
      let best = Infinity;
      for (const r of member.roles || []) {
        const idx = priority.indexOf(r.role);
        if (idx !== -1 && idx < best) {
          best = idx;
          primaryRole = r.role;
        }
      }
      if (primaryRole === "player") count++;
    }
    return count;
  }, [members]);



  // When the pitch board is opened in the context of a match (linkedEventId
  // set by the "nearby game" detection), restrict the roster to players whose
  // RSVP for that event is "going". Adults (staff) are always retained so they
  // can run the board. Without an event link we keep the full roster.
  const { data: goingRsvpsForLinkedEvent } = useQuery({
    queryKey: eventKeys.pitchGoingRsvps(linkedEventId),
    queryFn: async () => {
      if (!linkedEventId) return null;
      const { data, error } = await supabase
        .from("rsvps")
        .select("user_id, child_id, status")
        .eq("event_id", linkedEventId)
        .eq("status", "going");
      if (error) throw error;
      return data || [];
    },
    enabled: !!linkedEventId && !useIcpLab,
    staleTime: 30_000,
  });

  const pitchBoardMembers = useMemo(() => {
    const STAFF_ROLES = new Set(["team_admin", "coach", "club_admin", "app_admin"]);
    const goingChildIds = goingRsvpsForLinkedEvent
      ? new Set(goingRsvpsForLinkedEvent.map(r => r.child_id).filter((v): v is string => !!v))
      : null;
    const goingAdultIds = goingRsvpsForLinkedEvent
      ? new Set(goingRsvpsForLinkedEvent.map(r => r.user_id).filter((v): v is string => !!v))
      : null;

    const adults = rawMembers
      .filter(m => !goingAdultIds || STAFF_ROLES.has(m.role) || goingAdultIds.has(m.user_id))
      .map(m => ({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        profiles: m.profiles,
      }));

    const children = teamChildren
      .filter(child => child.children)
      .filter(child => !goingChildIds || goingChildIds.has(child.children.id))
      .map(child => ({
        id: `child-${child.children.id}`,
        user_id: child.children.id,
        role: "player" as string,
        profiles: { display_name: child.children.name, avatar_url: null },
      }));

    return [...adults, ...children];
  }, [rawMembers, teamChildren, goingRsvpsForLinkedEvent]);

  const isPitchBoardRosterLoading = isMembersLoading || isMembersFetching || isChildrenLoading || isChildrenFetching;

  const { data: userRoleRows = [], isLoading: isUserRoleLoading } = useQuery({
    queryKey: ["user-team-roles", id, user?.id],
    queryFn: async () => {
      if (isFeatureRoutedToIcp("membership")) {
        // Live ICP: own role grants from club_domain (no Supabase user_roles
        // rows exist for II accounts).
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const grants = await getLiveMyRoleGrants(ctx);
            return grants
              .filter((g) => (g.team?.[0] ?? null) === id!)
              .map((g) => ({ role: g.role, via_captain: null as boolean | null }));
          },
        });
      }
      const { data } = await supabase
        .from("user_roles")
        .select("role, via_captain")
        .eq("user_id", user!.id)
        .eq("team_id", id!);
      return (data ?? []) as Array<{ role: string; via_captain: boolean | null }>;
    },
    enabled: !!id && !!user && !useIcpLab,
  });

  const userRoles = userRoleRows.map(r => r.role);
  // Captains receive a `team_admin` role row marked `via_captain`. They get the
  // same day-to-day management rights, but must not reach team settings or the
  // destructive team actions (mirrors the RLS policy on `teams`).
  const hasRealTeamAdminRole = userRoleRows.some(r => r.role === "team_admin" && !r.via_captain);
  const isCaptainAdmin = userRoleRows.some(r => r.role === "team_admin" && !!r.via_captain);

  // Get primary role for display - prioritize admin roles
  const userRole = userRoles.includes("team_admin") ? "team_admin" 
    : userRoles.includes("coach") ? "coach"
    : userRoles[0] ?? null;

  // Shared app-admin detection: Supabase user_roles in Supabase mode,
  // insights_domain in ICP mode. The shared hook owns the ["is-app-admin"]
  // query key so every page resolves it the same way.
  const { isAppAdmin, isLoading: isAppAdminLoading } = useIsAppAdmin();

  const isCoachOrAdmin = userRole === "team_admin" || userRole === "coach" || isAppAdmin;
  const isAdmin = isCoachOrAdmin;
  // Club admins should have the same team-management actions in the team menu
  const canManageTeam = isAdmin || isClubAdmin;
  // Settings / archive / delete stay with real admins only — captains are excluded.
  const canEditTeamSettings =
    hasRealTeamAdminRole ||
    userRoles.includes("coach") ||
    !!isAppAdmin ||
    !!isClubAdmin;
  // Only real admins may appoint or remove captains.
  const canManageCaptains = hasRealTeamAdminRole || !!isAppAdmin || !!isClubAdmin;
  // isMember includes club admins - they have implicit access to all teams in their club
  const isMember = userRoles.length > 0 || isAppAdmin || isClubAdmin;


  // Sticky pitch-board access gate. `isSoccerClub` / `hasProFootball` /
  // `isAppAdmin` all come from async queries that can transiently return
  // undefined/false on app resume (aborted in-flight GETs, refetch errors).
  // Without a latch the mounted board unmounts mid-game and the user is left
  // staring at the team page. Once access has been proven we keep the board
  // rendered for as long as it is open.
  const rawPitchBoardAccess = !!(isSoccerClub && (hasProFootball || isAppAdmin));
  const pitchBoardAccessEverGrantedRef = useRef(false);
  if (rawPitchBoardAccess) pitchBoardAccessEverGrantedRef.current = true;
  const pitchBoardAccessGranted =
    rawPitchBoardAccess || pitchBoardAccessEverGrantedRef.current;

  const { data: nearbySubsManagerEventId } = useQuery({
    queryKey: ["nearby-subs-manager-event", id, user?.id],
    queryFn: async () => {
      const nearbyEventId = await findNearbyGameEvent(id!);
      if (!nearbyEventId) return null;
      const { data, error } = await supabase
        .from("duties")
        .select("id, name")
        .eq("event_id", nearbyEventId)
        .eq("assigned_to", user!.id);
      if (error) throw error;
      return (data || []).some((d: any) => normalizeDutyName(d.name) === "subs manager") ? nearbyEventId : null;
    },
    enabled: !!id && !!user && !isCoachOrAdmin && !isClubAdmin && !useIcpLab,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const hasNearbySubsManagerDuty = !!nearbySubsManagerEventId;
  
  // isClubAdmin is already defined above (before isSubscriptionLoading calculation)
  
  // All team members can view pitch board (read-only); only team admins/coaches can edit
  // Subs Manager duty check is done dynamically when the pitch board opens with a linkedEventId
  const canAccessPitchBoard = isMember;
  const canEditPitchBoard = isCoachOrAdmin || isClubAdmin || hasNearbySubsManagerDuty; // Club admins, team admins, coaches, and match Subs Managers can edit

  // Check if user has "Subs Manager" duty for the linked event
  const { data: isSubsManager } = useQuery({
    queryKey: ["subs-manager-duty", linkedEventId, user?.id],
    queryFn: async () => {
      if (!linkedEventId || !user) return false;
      const { data } = await supabase
        .from("duties")
        .select("id, name")
        .eq("event_id", linkedEventId)
        .eq("assigned_to", user.id)
      return (data || []).some((d: any) => normalizeDutyName(d.name) === "subs manager");
    },
    enabled: !!linkedEventId && !!user && !useIcpLab,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Detect a live game for this team so we can show a "Watch Live" entry
  // point to all team members (parents/players included). Polls every 30s
  // because the coach's sync also updates `active_games.updated_at` regularly
  // — that's the cheapest reliable signal without subscribing on every
  // team page load.
  const { data: activeGame } = useQuery({
    queryKey: ["team-active-game", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("active_games")
        .select("id, updated_at, pitch_state")
        .eq("team_id", id!)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!id && (isMember || isClubAdmin) && !useIcpLab,
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const liveSport = (activeGame?.pitch_state as { sport?: string } | null)?.sport ?? null;
  const showWatchLive =
    !!activeGame && (liveSport === "basketball" || liveSport === "netball") && !showPitchBoard;

  // Fetch pending invites for this team
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites", id, null],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, role, invited_user_id, invited_label, invited_email, created_at, status, email_sent_at, email_id, email_error, last_reminder_sent_at, reminder_count, metadata")
        .eq("team_id", id!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      
      // Filter out anonymous share-link invites with no identifying info
      const identifiableInvites = (data || []).filter(
        inv => inv.invited_label || inv.invited_email || inv.invited_user_id
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
      
      // Strip email for non-admins to protect privacy
      if (!isCoachOrAdmin && !isClubAdmin) {
        return invitesWithProfiles.map(inv => ({
          ...inv,
          invited_email: undefined,
          email_sent_at: undefined,
          email_id: undefined,
          email_error: undefined,
        }));
      }
      return invitesWithProfiles;
    },
    enabled: !!id && isMember && !useIcpLab,
  });
  const { data: existingRequest } = useQuery({
    queryKey: ["team-request", id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("role_requests")
        .select("*")
        .eq("team_id", id!)
        .eq("user_id", user!.id)
        .eq("status", "pending")
        .maybeSingle();
      return data;
    },
    enabled: !!id && !!user && !isMember && !useIcpLab,
  });

  const requestRoleMutation = useMutation({
    mutationFn: async () => {
      // Canister request_role stores no parent/child metadata, so the
      // child-link prompts below stay Supabase-only; the ICP branch submits
      // the bare role request.
      if (isIcpAccount) {
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => { await requestLiveRole(ctx, team!.club_id, selectedRole, id!); },
        });
        return;
      }
      const metadata: Record<string, any> = {};
      if (selectedRole === "parent") {
        const trimmedNew = newChildName.trim();
        if (selectedChildForLink && selectedChildForLink !== "__new__") {
          const child = teamChildren.find((c: any) => c.children?.id === selectedChildForLink);
          metadata.child_id = selectedChildForLink;
          metadata.child_name = child?.children?.name || "";
        } else if (trimmedNew) {
          metadata.child_name = trimmedNew;
        } else {
          throw new Error("Please select your child or add their name");
        }
      }
      const { error } = await supabase.from("role_requests").insert({
        user_id: user!.id,
        team_id: id!,
        club_id: team?.club_id,
        role: selectedRole,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      } as any);
      if (error) throw error;
      // Admin notifications are created by the on_role_request_created DB trigger
      // (which includes the requester's name). No client-side insert needed.
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-request", id] });
      setSelectedChildForLink("");
      setNewChildName("");
      toast({ title: "Request submitted", description: "An admin will review your request." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to submit request", description: error.message, variant: "destructive" });
    },
  });

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPermanentDeleteDialog, setShowPermanentDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (useIcpLab) {
      toast({ title: "Team deletion is unavailable in ICP lab mode", variant: "destructive" });
      return;
    }
    if (isDeleting) return; // prevent duplicate submission
    setIsDeleting(true);
    // Team soft-delete is a club_domain call with no notification/tombstone
    // equivalent on the canister; handle it separately and skip the
    // Supabase-only recipient lookup / notification insert below.
    if (isFeatureRoutedToIcp("membership")) {
      try {
        await withFeatureBackend("membership", {
          supabase: () => softDeleteLiveTeam({} as any, id!), // unreachable: gated by isFeatureRoutedToIcp above
          icp: (ctx) => softDeleteLiveTeam(ctx, id!),
        });
        markTeamDeleted(id!);
        queryClient.invalidateQueries({ queryKey: ["team", id] });
        if (team?.club_id) {
          queryClient.invalidateQueries({ queryKey: ["club", team.club_id] });
          queryClient.invalidateQueries({ queryKey: ["club-teams", team.club_id] });
        }
        // Refresh the home carousel (React Query + localStorage snapshot) and
        // every team-derived list so the deleted team disappears immediately.
        await invalidateTeamLists(queryClient, user?.id);
        setShowDeleteDialog(false);
        toast({ title: "Team deleted", description: "You can restore it within 30 days." });
        navigate(`/clubs/${team?.club_id}`);
      } catch (error) {
        toast({ title: "Error", description: "Failed to delete team.", variant: "destructive" });
      } finally {
        setIsDeleting(false);
      }
      return;
    }
    try {
      // 1. Load + dedupe intended notification recipients (excluding initiator)
      const { data: teamMembers } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", id!);

      const recipientIds = Array.from(
        new Set(
          (teamMembers || [])
            .map((m) => m.user_id)
            .filter((uid): uid is string => !!uid && uid !== user?.id),
        ),
      );

      // 2. Attempt the soft-delete FIRST — nobody is contacted until it commits.
      const { error: deleteError } = await supabase.from("teams").update({
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id,
      } as any).eq("id", id!);

      if (deleteError) {
        // Deletion failed: no notifications, no navigation, dialog stays open.
        toast({
          title: "Error",
          description: "Failed to delete team.",
          variant: "destructive",
        });
        return;
      }

      // 3. Deletion committed — now notify.
      let notificationError: string | null = null;
      if (recipientIds.length > 0) {
        const { withFeatureBackend } = await import("@/live/featureRouter");
        const { fanOutLiveNotifications } = await import("@/live/features/notifications");
        await withFeatureBackend("notifications", {
          supabase: async () => {
            const { error: notifyError } = await supabase.from("notifications").insert(
              recipientIds.map((uid) => ({
                user_id: uid,
                type: "membership",
                message: `${team?.name || "A team"} has been deleted`,
                related_id: team?.club_id,
              })),
            );
            if (notifyError) notificationError = notifyError.message;
          },
          icp: async (ctx) => {
            try {
              await fanOutLiveNotifications(ctx, {
                userIds: recipientIds,
                clubId: team!.club_id,
                kind: "membership",
                body: `${team?.name || "A team"} has been deleted`,
                idempotencyKeyPrefix: `team-deletion-${id}-${Date.now()}`,
                relatedId: team!.club_id,
              });
            } catch (e) {
              notificationError = e instanceof Error ? e.message : String(e);
            }
          }
        });
      }

      queryClient.invalidateQueries({ queryKey: ["team", id] });
      if (team?.club_id) {
        queryClient.invalidateQueries({ queryKey: ["club", team.club_id] });
        queryClient.invalidateQueries({ queryKey: ["club-teams", team.club_id] });
      }
      queryClient.invalidateQueries({ queryKey: ["my-teams"] });

      // Picker query families that list selectable teams — these must drop the
      // deleted team immediately, otherwise Event creation / Gallery / Vault
      // pickers keep showing it from a stale cache until an app restart.
      queryClient.invalidateQueries({ queryKey: ["club-teams-for-event"] });
      queryClient.invalidateQueries({ queryKey: ["all-club-teams-for-target"] });
      queryClient.invalidateQueries({ queryKey: ["user-teams-upload-sheet"] });
      queryClient.invalidateQueries({ queryKey: ["media-filter-teams"] });
      queryClient.invalidateQueries({ queryKey: ["vault-club-teams"] });


      // Purge every client-side cache that still holds this team, so a
      // soft-deleted team can never repaint as a phantom second chat thread
      // (e.g. after a team with the same name is recreated).
      markTeamDeleted(id!);
      if (user?.id) {
        removeTeamFromMessagesPageCache(user.id, id!);
        queryClient.setQueryData(
          ["my-teams-with-messages", user.id],
          (old: any) => {
            if (!old?.teams) return old;
            const latestMessages = { ...(old.latestMessages || {}) };
            delete latestMessages[id!];
            return {
              ...old,
              teams: old.teams.filter((t: any) => t?.id !== id),
              latestMessages,
            };
          },
        );
        queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages", user.id] });
      }

      setShowDeleteDialog(false);

      if (notificationError) {
        toast({
          title: "Team deleted — notifications failed",
          description: `The team was deleted, but some members may not have been notified. ${notificationError}`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Team deleted", description: "You can restore it within 30 days." });
      }

      navigate(`/clubs/${team?.club_id}`);
    } finally {
      setIsDeleting(false);
    }
  };


  const handleRestoreTeam = async () => {
    if (useIcpLab) {
      toast({ title: "Team restore is unavailable in ICP lab mode", variant: "destructive" });
      return;
    }
    try {
      await withFeatureBackend("membership", {
        supabase: async () => {
          const { error } = await supabase.from("teams").update({
            deleted_at: null,
            deleted_by: null,
          } as any).eq("id", id!);
          if (error) throw error;
        },
        icp: async (ctx) => { await restoreLiveTeam(ctx, id!); },
      });
    } catch (error) {
      toast({ title: "Error", description: "Failed to restore team.", variant: "destructive" });
      return;
    }

    unmarkTeamDeleted(id!);
    toast({ title: "Team restored!" });
    queryClient.invalidateQueries({ queryKey: ["team", id] });
    if (user?.id) {
      queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages", user.id] });
    }
    await invalidateTeamLists(queryClient, user?.id);
  };

  const handlePermanentDeleteTeam = async () => {
    if (useIcpLab) {
      toast({ title: "Permanent team deletion is unavailable in ICP lab mode", variant: "destructive" });
      return;
    }
    setIsDeleting(true);
    try {
      await withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase.functions.invoke("permanent-delete-entity", {
            body: { entityType: "team", entityId: id },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
        },
        icp: (ctx) => deleteLiveTeamPermanent(ctx, id!),
      });

      setShowPermanentDeleteDialog(false);
      toast({ title: "Team permanently deleted", description: "All data has been removed." });
      navigate(`/clubs/${team?.club_id}`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to permanently delete team.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const showPitch = (isAdmin || isCoachOrAdmin || isClubAdmin || hasNearbySubsManagerDuty)
    && isSoccerClub && (hasProFootball || isAppAdmin);

  const launchPitchBoard = async () => {
    const [membersResult, childrenResult, nearbyEventId] = await Promise.all([
      refetchMembers(),
      refetchChildren(),
      findNearbyGameEvent(id!),
    ]);
    const freshMembers = membersResult.data || [];
    const freshChildren = childrenResult.data || [];
    let goingChildIds: Set<string> | null = null;
    let goingAdultIds: Set<string> | null = null;
    if (nearbyEventId) {
      const { data: goingRows } = await supabase
        .from("rsvps")
        .select("user_id, child_id")
        .eq("event_id", nearbyEventId)
        .eq("status", "going");
      goingChildIds = new Set((goingRows || []).map(r => r.child_id).filter((v): v is string => !!v));
      goingAdultIds = new Set((goingRows || []).map(r => r.user_id).filter((v): v is string => !!v));
    }
    const STAFF_ROLES = new Set(["team_admin", "coach", "club_admin", "app_admin"]);
    const nextPitchBoardMembers = [
      ...freshMembers.filter(m => !goingAdultIds || STAFF_ROLES.has(m.role) || goingAdultIds.has(m.user_id)).map(m => ({
        id: m.id, user_id: m.user_id, role: m.role, profiles: m.profiles,
      })),
      ...freshChildren
        .filter(child => child.children)
        .filter(child => !goingChildIds || goingChildIds.has(child.children.id))
        .map(child => ({
          id: `child-${child.children.id}`, user_id: child.children.id,
          role: "player" as string,
          profiles: { display_name: child.children.name, avatar_url: null },
        })),
    ];
    setPitchBoardMembersOverride(nextPitchBoardMembers);
    setLinkedEventId(nearbyEventId);
    setShowPitchBoard(true);
  };

  if (isLoading || (teamQueryPaused && !team)) {
    return (
      <div className="py-6 space-y-6" role="status" aria-label="Loading team">
        <Skeleton className="h-8 w-32" aria-hidden="true" />
        <Skeleton className="h-32 w-full" aria-hidden="true" />
        <span className="sr-only">Loading team…</span>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Team not found</p>
      </div>
    );
  }

  return (
    <div className="py-4 space-y-4">
      {/* Header: Back, Team name + member count, Invite CTA, overflow menu */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="shrink-0 min-h-[48px] min-w-[48px] h-12 w-12 -ml-2" aria-label="Go back" onClick={() => {
          if (location.key && location.key !== "default") {
            navigate(-1);
          } else {
            navigate(`/clubs/${team.club_id}`);
          }
        }}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate leading-tight">{team.name}</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            {Object.keys(members).length + teamChildren.length} member{Object.keys(members).length + teamChildren.length !== 1 ? 's' : ''}
          </p>
        </div>
        {(isAdmin || isClubAdmin) && (
          <Button size="sm" className="shrink-0 h-9" onClick={() => setHeaderInviteOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1.5" />
            Invite
          </Button>
        )}
        {canEditTeamSettings && isClassMode && (
          <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={`Edit ${isClassMode ? 'class' : 'team'}`} onClick={() => navigate(`/teams/${id}/edit`)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        {(isAdmin || isClubAdmin) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="Team options menu">
                <MoreVertical className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEditTeamSettings && <DropdownMenuItem onClick={() => navigate(`/teams/${id}/edit`)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit {isClassMode ? "Class" : "Team"}
              </DropdownMenuItem>}
              {isClassMode && (
                <DropdownMenuItem onClick={async () => {
                  const { data: newTeam, error } = await supabase
                    .from("teams")
                    .insert({
                      name: `${team.name} (Copy)`,
                      club_id: team.club_id,
                      level_age: (team as any).level_age || null,
                      description: (team as any).description || null,
                      folder_id: (team as any).folder_id || null,
                      team_type: (team as any).team_type || "mixed",
                      created_by: user!.id,
                      class_day: (team as any).class_day || null,
                      class_time: (team as any).class_time || null,
                      class_duration_minutes: (team as any).class_duration_minutes || null,
                      class_capacity: (team as any).class_capacity || null,
                    })
                    .select()
                    .single();
                  if (error) {
                    toast({ title: "Failed to duplicate class", variant: "destructive" });
                  } else {
                    toast({ title: "Class duplicated", description: `"${newTeam.name}" created. Edit it to customise.` });
                    navigate(`/teams/${newTeam.id}/edit`);
                  }
                }}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate Class
                </DropdownMenuItem>
              )}
              {/* Leave Team - only for members (not pure club admins) */}
              {userRoles.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <TeamLeaveDialog
                    teamName={team?.name || ""}
                    onConfirmLeave={async () => {
                      const { error } = await supabase
                        .from("user_roles")
                        .delete()
                        .eq("user_id", user!.id)
                        .eq("team_id", id!);
                      if (error) {
                        toast({ title: "Failed to leave team", variant: "destructive" });
                      } else {
                        const today = new Date().toISOString().slice(0, 10);
                        const { data: futureEvents } = await supabase
                          .from("events")
                          .select("id")
                          .eq("team_id", id!)
                          .gte("event_date", today);
                        if (futureEvents && futureEvents.length > 0) {
                          await supabase
                            .from("rsvps")
                            .delete()
                            .eq("user_id", user!.id)
                            .in("event_id", futureEvents.map(e => e.id));
                        }
                        toast({ title: `You left ${team?.name || "the team"}` });
                        refreshAfterLeavingTeam(queryClient, id!);
                        navigate(`/clubs/${team?.club_id}`);
                      }
                    }}
                  />
                </>
              )}
              {canEditTeamSettings && <DropdownMenuSeparator />}
              {canEditTeamSettings && <ArchiveTeamDialog
                teamId={id!}
                teamName={team?.name || ""}
                clubId={team?.club_id || ""}
                isArchived={(team as any)?.is_archived || false}
                currentSeasonLabel={(team as any)?.season_label}
                onSuccess={() => navigate(`/clubs/${team?.club_id}`)}
                trigger={
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-amber-600">
                    {(team as any)?.is_archived ? (
                      <><ArchiveRestore className="h-4 w-4 mr-2" />Reinstate Team</>
                    ) : (
                      <><Archive className="h-4 w-4 mr-2" />Archive Team</>
                    )}
                  </DropdownMenuItem>
                }
              />
              }
              {canEditTeamSettings && <DropdownMenuItem
                className="text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Team
              </DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Hidden AddTeamMemberSheet controlled by header Invite button */}
      {(isAdmin || isClubAdmin) && headerInviteOpen && (
        <Suspense fallback={null}>
        <AddTeamMemberSheet
          teamId={id!}
          teamName={team.name}
          clubId={team.club_id}
          teamType={(team as any).team_type || "mixed"}
          isClubAdminOnly={isClubAdmin && !isCoachOrAdmin}
          canBulkInvite={isCoachOrAdmin || isClubAdmin}
          triggerVariant="none"
          externalOpen={headerInviteOpen}
          onExternalOpenChange={setHeaderInviteOpen}
        />
        </Suspense>
      )}

      {(isAdmin || isClubAdmin) && (
        <Suspense fallback={null}>
        <AddPlayerToParentSheet
          open={addPlayerOpen}
          onOpenChange={setAddPlayerOpen}
          teamId={id!}
          teamName={team.name}
          clubId={team.club_id}
          rawMembers={rawMembers as any}
        />
        </Suspense>
      )}

      {/* Soft-deleted banner */}
      {(team as any)?.deleted_at && canManageTeam && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center gap-3">
              <Trash2 className="h-5 w-5 text-destructive shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">This team has been removed</p>
                <p className="text-xs text-muted-foreground">
                  Removed {new Date((team as any).deleted_at).toLocaleDateString()} · Will be permanently deleted after 30 days
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={handleRestoreTeam}>
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
        entityName={team?.name || ""}
        entityType="team"
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />

      <ConfirmDeleteDialog
        open={showPermanentDeleteDialog}
        onOpenChange={setShowPermanentDeleteDialog}
        entityName={team?.name || ""}
        entityType="team"
        onConfirm={handlePermanentDeleteTeam}
        isLoading={isDeleting}
        permanent
      />

      {/* Archived Banner */}
      {(team as any)?.is_archived && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-3 flex items-center gap-3">
            <Archive className="h-5 w-5 text-warning shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                This team is archived{(team as any)?.season_label ? ` · ${(team as any).season_label}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">Read-only — history is preserved. Only admins can see this team.</p>
            </div>
            {isAdmin && (
              <ArchiveTeamDialog
                teamId={id!}
                teamName={team.name || ""}
                clubId={team.club_id || ""}
                isArchived={true}
                currentSeasonLabel={(team as any)?.season_label}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ["team", id] })}
                trigger={
                  <Button size="sm" variant="outline" className="shrink-0">
                    <ArchiveRestore className="h-4 w-4 mr-1" /> Reinstate
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      )}


      {/* Enrolment Link for Class-mode teams - hide if already enrolled */}
      {team.clubs?.class_mode_enabled && team.class_day && !isEnrolledInClass && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 hover:border-primary/50 transition-colors cursor-pointer"
          role="button"
          tabIndex={0}
          aria-label="Enrol in this class"
          onClick={() => navigate(`/clubs/${team.club_id}/enrol`)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/clubs/${team.club_id}/enrol`); } }}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Enrol in this Class</p>
              <p className="text-xs text-muted-foreground">View availability and enrol</p>
            </div>
            <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180" />
          </CardContent>
        </Card>
      )}

      {/* Team Sponsor Display */}
      {team.sponsor_id && (
        <PrimarySponsorDisplay sponsorId={team.sponsor_id} variant="full" context="team_page" />
      )}

      {/* Upgrade Banner - Show only for team/club admins without pro access, hidden in class mode */}
      {!isClassMode && (isAdmin || isClubAdmin) && !isTeamPro && !hasProFootball && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2 shrink-0">
                <Crown className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Unlock Pro Features</p>
                <p className="text-xs text-muted-foreground">Get Points & Rewards, media uploads, and more</p>
              </div>
              <Button size="sm" onClick={() => navigate(`/teams/${team.id}/upgrade`)}>
                Upgrade
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscription Banner - Show for admins when team has an active trial */}
      {!isClassMode && (isAdmin || isClubAdmin) && isOnTrial && isTeamPro && (() => {
        // Determine trial source: team_subscriptions, club_subscriptions, or legacy teams table
        const isLegacyTeamTrial = !teamSubscription?.is_trial && !clubSubscription?.is_trial && team?.is_pro && (team as any)?.pro_expires_at;
        const isCancelled = teamSubscription?.is_trial 
          ? !!(teamSubscription as any)?.cancelled_at 
          : clubSubscription?.is_trial 
            ? !!(clubSubscription as any)?.cancelled_at 
            : false;
        const trialEndDate = teamSubscription?.is_trial 
          ? teamSubscription?.trial_ends_at 
          : clubSubscription?.is_trial
            ? clubSubscription?.trial_ends_at
            : isLegacyTeamTrial
              ? (team as any)?.pro_expires_at
              : null;
        const isClubTrial = !teamSubscription?.is_trial && clubSubscription?.is_trial && !isLegacyTeamTrial;
        const canCancel = (teamSubscription?.is_trial && !isCancelled) || isLegacyTeamTrial;

        return (
          <Card className={`border-amber-500/30 ${isCancelled ? 'bg-gradient-to-br from-muted/50 to-muted/30' : 'bg-gradient-to-br from-amber-500/5 to-amber-500/10'}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`rounded-full p-2 shrink-0 ${isCancelled ? 'bg-muted' : 'bg-amber-500/10'}`}>
                  <Crown className={`h-5 w-5 ${isCancelled ? 'text-muted-foreground' : 'text-amber-500'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  {isCancelled ? (
                    <>
                      <p className="font-medium text-sm">Subscription Cancelled</p>
                      <p className="text-xs text-muted-foreground">
                        Pro features active until {trialEndDate ? new Date(trialEndDate).toLocaleDateString() : 'trial ends'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-sm">Free Trial Active</p>
                      <p className="text-xs text-muted-foreground">
                        {isClubTrial ? 'Club trial' : 'Trial'} ends {trialEndDate ? new Date(trialEndDate).toLocaleDateString() : 'soon'}
                      </p>
                    </>
                  )}
                </div>
                {isClubTrial && team?.club_id ? (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate(`/clubs/${team.club_id}/upgrade`)}>
                    Manage
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Join Request Section for Non-members - hidden in class mode (use enrolment page instead) */}
      {!isClassMode && !isUserRoleLoading && !isClubAdminLoading && !isAppAdminLoading && !isMember && !isClubAdmin && (
        <TeamJoinRequestCard
          teamName={team.name}
          existingRequest={existingRequest}
          selectedRole={selectedRole}
          onSelectedRoleChange={setSelectedRole}
          teamChildren={teamChildren}
          selectedChildForLink={selectedChildForLink}
          onSelectedChildForLinkChange={setSelectedChildForLink}
          newChildName={newChildName}
          onNewChildNameChange={setNewChildName}
          isSubmitting={requestRoleMutation.isPending}
          onSubmit={() => requestRoleMutation.mutate()}
        />
      )}

      {/* Post-creation onboarding nudge — shown to admins until both
          "invite members" and "add first event" are complete (or dismissed). */}
      {(isAdmin || isClubAdmin) && (
        <TeamNextStepsCard teamId={id!} onInvite={() => setHeaderInviteOpen(true)} />
      )}

      {/* Next Event Card — dominant hero */}
      {isMember && (
        <TeamNextEventCard teamId={id!} clubId={team.club_id} />
      )}

      {/* Watch Live banner — shown to ALL team members when a coach is running
          a basketball/netball board. Read-only spectator view; no controls. */}
      {isMember && showWatchLive && (
        <Link
          to={`/watch/team/${team.id}`}
          aria-label="Watch live game"
          className="block"
        >
          <Card className="border-primary/30 bg-primary/[0.05] hover:border-primary/50 transition-colors" role="button">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/15 relative">
                <Radio className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Watch Live</span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-destructive/40 text-destructive">
                    LIVE
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground capitalize">
                  {liveSport} game in progress
                </p>
              </div>
              <Eye className="h-4 w-4 text-primary shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Quick Actions — chat row + compact tile grid */}
      {isMember && (
        <TeamQuickActionsSection
          teamId={id!}
          isSubscriptionLoading={isSubscriptionLoading}
          isTeamPro={isTeamPro}
          isAppAdmin={isAppAdmin}
          isAdmin={isAdmin}
          isCoachOrAdmin={isCoachOrAdmin}
          isClubAdmin={isClubAdmin}
          hasNearbySubsManagerDuty={hasNearbySubsManagerDuty}
          showPitch={showPitch}
          onPitchBoardClick={launchPitchBoard}
        />
      )}

      {/* Latest Photos — emotional/social engagement */}
      {isMember && (
        <TeamLatestPhotos teamId={id!} clubId={team.club_id} />
      )}

      {/* Compact rank module — secondary emphasis, includes "ways to improve" */}
      {isMember && (
        <TeamRankCard teamId={id!} clubId={team.club_id} />
      )}

      {/* Collapsible Sections */}
      {(isMember || isClubAdmin) && (
        <TeamDetailAccordionSections
          teamId={id!}
          teamName={team.name}
          clubId={team.club_id}
          teamType={(team as any).team_type}
          teamSponsorId={team.sponsor_id}
          isMember={isMember}
          isClubAdmin={isClubAdmin}
          isAdmin={isAdmin}
          isCoachOrAdmin={isCoachOrAdmin}
          isAppAdmin={isAppAdmin}
          isClassMode={isClassMode}
          isSoccerClub={!!isSoccerClub}
          isBasketballClub={isBasketballClub}
          isNetballClub={isNetballClub}
          isSubscriptionLoading={isSubscriptionLoading}
          isTeamPro={isTeamPro}
          hasProFootball={hasProFootball}
          canManageCaptains={canManageCaptains}
          membersSectionProps={{
            members, teamChildren, pendingInvites, memberRoleFilter, adultPlayerCount, isAdmin, isClubAdmin, currentUserId: user?.id,
            isMembersLoading, isMembersFetching, isChildrenLoading, isChildrenFetching, isMembersError, membersError, refetchMembers, refetchChildren,
            isSoccerClub: !!isSoccerClub, onOpenHeaderInvite: () => setHeaderInviteOpen(true), onOpenAddPlayer: () => setAddPlayerOpen(true),
            onSelectChild: setSelectedChild, onLinkChildToParent: setLinkChildToParent, onMoveToTeam: setMoveToTeam, onAddRoleMember: setAddRoleMember,
            onSelectMember: setSelectedMember, onInviteParentChild: setInviteParentChild, onOpenPositionSheet: setPositionSheetPlayer, onRemoveMember: setRemoveMember,
          }}
          teamSubscription={teamSubscription}
          clubSubscription={clubSubscription}
          onProOverrideChange={(checked) => saveAppAdminOverride({ admin_pro_override: checked })}
          onProFootballOverrideChange={(checked) => saveAppAdminOverride({ admin_pro_football_override: checked })}
          onSponsorUpdate={() => queryClient.invalidateQueries({ queryKey: ["team", id] })}
          isSavingPitchSettings={isSavingPitchSettings}
          defaultMinutesPerHalf={defaultMinutesPerHalfForTeamName(team.name)}
          savePitchSetting={savePitchSetting}
          refetchMembers={refetchMembers}
          refetchChildren={refetchChildren}
        />
      )}

      {/* Competitions Section */}
      <TeamCompetitionsSection teamId={id!} canManage={isAdmin || isCoachOrAdmin || isClubAdmin} />

      {/* Pitch Board Modal — soccer */}
      {showPitchBoard && pitchBoardAccessGranted && createPortal(
        <Suspense fallback={
          <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: '#2d5a27' }}>
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary">
                  <Flame className="h-8 w-8 text-primary-foreground" />
                </div>
                <span className="text-4xl animate-bounce">⚽</span>
              </div>
              <Loader2 className="h-6 w-6 animate-spin text-white" />
              <p className="text-lg font-medium text-white">
                {isPitchBoardRosterLoading ? "Loading players..." : "Loading Pitch Board..."}
              </p>
            </div>
          </div>
        }>
          {isPitchBoardRosterLoading ? (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: '#2d5a27' }}>
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
                <p className="text-lg font-medium text-white">Loading players...</p>
              </div>
            </div>
          ) : (
            <PitchBoard
              teamId={id!}
              teamName={team.name}
              members={pitchBoardMembersOverride.length > 0 ? pitchBoardMembersOverride : pitchBoardMembers}
              onClose={() => {
                clearPitchBoardOpenFlag();
                setShowPitchBoard(false);
                setLinkedEventId(null);
                setPitchBoardMembersOverride([]);
              }}
              disableAutoSubs={teamSubscription?.disable_auto_subs || false}
              initialRotationSpeed={teamSubscription?.rotation_speed || 1}
              initialDisablePositionSwaps={teamSubscription?.disable_position_swaps || false}
              initialDisableBatchSubs={teamSubscription?.disable_batch_subs || false}
              initialRotateGkAtHalftime={teamSubscription?.rotate_gk_at_halftime ?? true}
              initialMinutesPerHalf={teamSubscription?.minutes_per_half || defaultMinutesPerHalfForTeamName(team?.name)}
              initialMaxSpreadMinutes={(teamSubscription as any)?.max_spread_minutes ?? 5}
              initialTeamSize={teamSubscription?.team_size}
              initialFormation={teamSubscription?.formation || undefined}
              readOnly={!canEditPitchBoard && !isSubsManager}
              isSubsManager={!!isSubsManager || hasNearbySubsManagerDuty}
              initialLinkedEventId={linkedEventId}
              onUnlinkEvent={() => {
                setLinkedEventId(null);
                setPitchBoardMembersOverride([]);
              }}
              initialShowLineupPicker={teamSubscription?.show_lineup_picker || false}
            />
          )}
        </Suspense>,
        document.body
      )}

      {/* Netball + Basketball Game Board modals archived — football-only build (see archive/sports/) */}

      {/* Admin invite dialog - shown after team creation with "assign someone else" option */}
      <TeamAdminInviteDialog
        open={showAdminInviteDialog}
        onOpenChange={(open) => {
          setShowAdminInviteDialog(open);
          // Clear the location state when dialog is closed to prevent re-showing on refresh
          if (!open && locationState?.showAdminInvite) {
            navigate(location.pathname, { replace: true, state: {} });
          }
        }}
        teamName={adminInviteTeamName || team?.name || ""}
        inviteName={adminInviteName}
        inviteEmail={adminInviteEmail}
        onDone={() => {
          setShowAdminInviteDialog(false);
          navigate(location.pathname, { replace: true, state: {} });
        }}
      />

      {/* Long-press position editor */}
      {positionSheetPlayer && id && (
        <PlayerPositionSheet
          open={!!positionSheetPlayer}
          onOpenChange={(open) => { if (!open) setPositionSheetPlayer(null); }}
          teamId={id}
          playerId={positionSheetPlayer.id}
          playerName={positionSheetPlayer.name}
          playerType={positionSheetPlayer.type}
        />
      )}
      {inviteParentChild && id && (
        <Suspense fallback={null}>
        <InviteOtherParentSheet
          open={!!inviteParentChild}
          onOpenChange={(open) => { if (!open) setInviteParentChild(null); }}
          childId={inviteParentChild.childId}
          childName={inviteParentChild.childName}
          teamIds={[id]}
        />
        </Suspense>
      )}
      {linkChildToParent && id && team && (
        <LinkChildToParentSheet
          open={!!linkChildToParent}
          onOpenChange={(open) => { if (!open) setLinkChildToParent(null); }}
          childName={linkChildToParent.childName}
          existingChildId={linkChildToParent.existingChildId}
          pendingInviteIds={linkChildToParent.pendingInviteIds}
          teamId={id}
          clubId={team.club_id || (team.clubs as any)?.id || ""}
          members={members}
        />
      )}
      {moveToTeam && id && team && (
        <MoveToTeamSheet
          open={!!moveToTeam}
          onOpenChange={(open) => { if (!open) setMoveToTeam(null); }}
          clubId={team.club_id || (team.clubs as any)?.id || ""}
          fromTeamId={id}
          fromTeamName={team.name}
          memberType={moveToTeam.type}
          memberId={moveToTeam.id}
          memberName={moveToTeam.name}
          memberRoles={moveToTeam.roles}
        />
      )}
      {addRoleMember && id && team && (
        <AddRoleToMemberDialog
          userId={addRoleMember.userId}
          userName={addRoleMember.userName}
          teamId={id}
          teamName={team.name}
          clubId={team.club_id}
          existingRoles={addRoleMember.existingRoles}
          open={!!addRoleMember}
          onOpenChange={(open) => { if (!open) setAddRoleMember(null); }}
        />
      )}
      <RemoveTeamMemberDialog
        memberName={removeMember?.name}
        open={!!removeMember}
        onOpenChange={(open) => { if (!open) setRemoveMember(null); }}
        onConfirm={async () => {
          if (!removeMember || !id) return;
          if (useIcpLab) {
            toast({ title: "Member removal is unavailable in ICP lab mode", variant: "destructive" });
            setRemoveMember(null);
            return;
          }
          try {
            await withFeatureBackend("membership", {
              supabase: async () => {
                // Use scoped RPC so team role, child assignments to this team,
                // and team-chat group memberships are revoked atomically.
                // child_guardians and access to unrelated teams are preserved.
                const { error } = await supabase.rpc("remove_team_member", {
                  _team_id: id,
                  _user_id: removeMember.userId,
                });
                if (error) throw error;

                await supabase.from("notifications").insert({
                  user_id: removeMember.userId,
                  type: "membership",
                  message: `You have been removed from ${team?.name || "the team"}`,
                  related_id: id,
                });
              },
              // Provisional: removeMember.userId is a principal string for
              // Internet Identity accounts; removes every role grant the
              // member holds in this team's club (no per-team scoping and no
              // notification equivalent on the canister).
              icp: async (ctx) => {
                await removeLiveMember(ctx, team!.club_id, Principal.fromText(removeMember.userId));
                // Best-effort in-app notification via notification_queue — a
                // notification failure must not roll back the member removal.
                try {
                  const { fanOutLiveNotifications } = await import("@/live/features/notifications");
                  await fanOutLiveNotifications(ctx, {
                    userIds: [removeMember.userId],
                    clubId: team!.club_id,
                    kind: "membership",
                    body: `You have been removed from ${team?.name || "the team"}`,
                    idempotencyKeyPrefix: `membership-removal-${removeMember.userId}-${id}-${Date.now()}`,
                    relatedId: id,
                  });
                } catch (e) {
                  console.error("Failed to send ICP notification:", e);
                }
              },
            });
            refreshRemovedTeamMember(queryClient, id);
            toast({ title: "Member removed" });
          } catch (error: any) {
            toast({ title: "Failed to remove member", description: error?.message, variant: "destructive" });
          }
          setRemoveMember(null);
        }}
      />
      {selectedMember && (
        <Suspense fallback={null}>
        <MemberDetailSheet
          open={!!selectedMember}
          onOpenChange={(open) => { if (!open) setSelectedMember(null); }}
          userId={selectedMember.userId}
          displayName={selectedMember.displayName}
          avatarUrl={selectedMember.avatarUrl}
          roles={selectedMember.roles}
          canManage={isAdmin || isClubAdmin}
          canMove={isClubAdmin && selectedMember.userId !== user?.id}
          isSelf={selectedMember.userId === user?.id}
          teamId={id}
          teamName={team.name}
          clubId={team.club_id}
          onRolesUpdated={() => {
            refreshTeamRoleChange(queryClient, id!);
            setSelectedMember(null);
          }}
          onAddRole={() => setAddRoleMember({
            userId: selectedMember.userId,
            userName: selectedMember.displayName,
            existingRoles: selectedMember.roles.map(r => r.role),
          })}
          onMove={() => setMoveToTeam({
            type: "adult",
            id: selectedMember.userId,
            name: selectedMember.displayName,
            roles: selectedMember.roles.map(r => r.role),
          })}
          onRemove={() => setRemoveMember({
            userId: selectedMember.userId,
            name: selectedMember.displayName,
          })}
          onRemoveRole={async (roleItem) => {
            const { error } = await supabase
              .from("user_roles")
              .delete()
              .eq("id", roleItem.id);
            if (error) {
              toast({ title: "Failed to remove role", variant: "destructive" });
            } else {
              toast({ title: "Role removed" });
              refreshTeamRoleChange(queryClient, id!);
              setSelectedMember(null);
            }
          }}
        />
        </Suspense>
      )}
      {selectedChild && (
        <ChildDetailSheet
          open={!!selectedChild}
          onOpenChange={(open) => { if (!open) setSelectedChild(null); }}
          childName={selectedChild.childName}
          parentDisplay={selectedChild.parentDisplay}
          isPending={selectedChild.isPending}
          canManage={isAdmin || isClubAdmin}
          showPosition={!!isSoccerClub}
          canMove={isClubAdmin}
          onInviteParent={() => setInviteParentChild({ childId: selectedChild.childId, childName: selectedChild.childName })}
          onEditPosition={() => setPositionSheetPlayer({ id: selectedChild.childId, name: selectedChild.childName, type: "child" })}
          onSwapTeam={() => setMoveToTeam({ type: "child", id: selectedChild.childId, name: selectedChild.childName })}
          onLink={selectedChild.isPending && selectedChild.linkInviteIds ? () => setLinkChildToParent({ childName: selectedChild.childName, existingChildId: selectedChild.childId, pendingInviteIds: selectedChild.linkInviteIds || [] }) : undefined}
          onRemove={(isAdmin || isClubAdmin) && !selectedChild.isPending ? () => setRemoveChild({ childId: selectedChild.childId, name: selectedChild.childName }) : undefined}
        />
      )}
      <RemoveTeamChildDialog
        childName={removeChild?.name}
        open={!!removeChild}
        onOpenChange={(open) => { if (!open) { setRemoveChild(null); setRemoveChildConfirmText(""); } }}
        confirmText={removeChildConfirmText}
        onConfirmTextChange={setRemoveChildConfirmText}
        onConfirm={async () => {
          if (!removeChild || !id) return;
          const { error } = await supabase
            .from("child_team_assignments")
            .delete()
            .eq("child_id", removeChild.childId)
            .eq("team_id", id);
          if (error) {
            toast({ title: "Failed to remove player", variant: "destructive" });
          } else {
            refreshRemovedTeamChild(queryClient, id);
            toast({ title: "Player removed" });
          }
          setRemoveChild(null);
          setRemoveChildConfirmText("");
        }}
      />
    </div>
  );
}
