import { useStickyList } from "@/hooks/useStickyList";
import { useStableInboxReadModel } from "@/hooks/useStableInboxReadModel";
import {
  conversationTypeAccentStyle,
  conversationTypeActiveStyle,
  conversationTypeBadgeStyle,
} from "@/features/messaging/inbox/inboxPresentation";
import { useState, useMemo, useEffect, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAllChatDrafts } from "@/hooks/useChatDraft";
import { usePersistedFilter } from "@/lib/persistedFilter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUserHasAnyAICatchUpClub } from "@/hooks/useUserHasAnyAICatchUpClub";
import { QueryErrorBanner } from "@/components/QueryErrorBanner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { WifiOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getCachedMessagesPageData, cacheMessagesPageData } from "@/lib/messagesPageCache";
import { filterDeletedTeams } from "@/lib/deletedTeamTombstones";
import { useClubTheme } from "@/hooks/useClubTheme";
import { fetchUnreadMessageCounts } from "@/lib/unreadMessageCounts";
import { useUnreadMessageCounts } from "@/hooks/useUnreadMessageCounts";
import { useGroupChatUnreadCache } from "@/hooks/useGroupChatUnreadCache";
import { isIgniteSupportUser } from "@/lib/systemUser";
import { queueChatInvalidation } from "@/lib/chatInvalidationQueue";

import { useMessagesPageBootstrap } from "@/hooks/useMessagesPageBootstrap";
import { useMessagesPageAccessData } from "@/hooks/useMessagesPageAccessData";
import { useAuthorizedScopes } from "@/hooks/useAuthorizedScopes";
import { registerChannel } from "@/lib/realtimeChannelRegistry";
import {
  createInboxRealtimeCoordinator,
  createInboxPreviewWatermarks,
  type InboxRealtimeEvent,
} from "@/features/messaging/inbox/inboxRealtimeReconciliation";
import {
  buildRealtimePreview,
  isAuthorizedInboxScope,
  mergeLatestMessagesPreview,
  moveDirectConversationToTop,
  patchDirectConversationEdit,
  type InboxAuthorizationSnapshot,
} from "@/features/messaging/inbox/inboxRealtimeCache";
import {
  buildUnifiedInboxConversations,
} from "@/features/messaging/inbox/inboxUnifiedComposition";
import { useInboxOpenLatency } from "@/features/messaging/inbox/useInboxOpenLatency";
import { useInboxPreviewReferenceNames } from "@/features/messaging/inbox/useInboxPreviewReferenceNames";
import { useInboxThreadPrefetch } from "@/features/messaging/inbox/useInboxThreadPrefetch";
import {
  collectDirectMessagePeerIds,
  collectPersonalGroupIds,
  filterInboxChatGroups,
  filterInboxClubs,
  filterInboxDirectMessages,
  filterInboxLeagueChats,
  filterInboxTeams,
  normalizeInboxSearchQuery,
  partitionInboxGroups,
} from "@/features/messaging/inbox/inboxFilterPolicy";
import {
  filterInboxConversations,
  normalizeInboxTypeFilter,
  partitionInboxByReadState,
  resolveOperationalConversationDisclosure,
  type InboxConversation,
  type InboxPreviewMessage,
} from "@/features/messaging/inbox/inboxReadModel";
import { mark as coldMark, snapshotStages } from "@/lib/coldStartMarks";
import { resetInboxOpenLog } from "@/lib/inboxOpenLatency";
import { notificationKeys } from "@/lab/notificationQueryKeys";

import { cacheProfiles, getProfileFromCache, selectCachedProfileById, selectCachedProfilesByIds } from "@/lib/profileCache";
import {
  fetchChatGroupsWithMessages,
  fetchDirectMessageConversations,
  fetchMemberClubsWithMessages,
  fetchTeamsWithMessages,
  type InboxClub,
  type InboxTeam,
} from "@/features/messaging/inbox/inboxPreviewSources";
import {
  fetchInboxClubScopeFilter,
  fetchInboxHiddenDirectMessages,
  fetchInboxHiddenGroups,
  fetchInboxMutedChats,
  fetchInboxSystemMessage,
} from "@/features/messaging/inbox/inboxRepositories";
import { clubAdminInboxQueryKey, fetchClubAdminConversations } from "@/components/chat/ClubAdminInboxList";
import { ConversationRow } from "@/components/chat/ConversationRow";
import { MessagesInboxSections } from "@/pages/MessagesInboxSections";
import { MessagesPageHeader } from "@/components/chat/MessagesPageHeader";
import { MessagesPageDialogs } from "@/components/chat/MessagesPageDialogs";

// Session-scoped first-reveal latch (per user id). Survives inbox unmount so
// warm re-entries paint cached rows immediately instead of re-running the
// initial ordering gate. Reset implicitly on reload / user switch.
let sessionRevealedInboxUserId: string | null = null;
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

const MESSAGES_PER_PAGE = 15;
const isNativeRuntime = () => !!(window as any).Capacitor?.isNativePlatform?.();
// Web polls aggressively (30s); native uses a longer interval to reduce
// background work on low-end Android WebViews while still keeping the inbox
// reasonably fresh between realtime events / resume refetches.
const INBOX_REFETCH_INTERVAL_MS = isNativeRuntime() ? 120000 : 30000;
// Jitter polling intervals so the ~5 inbox queries don't fire as a single
// burst every 30s (which caused render-storm + network burst). Each query
// gets an independent ±15% offset, spreading network + re-render work across
// a few seconds instead of landing simultaneously.
const jitteredInboxInterval = () => {
  const base = INBOX_REFETCH_INTERVAL_MS;
  const jitter = base * 0.15;
  return base + (Math.random() * 2 - 1) * jitter;
};
// Cap background prefetch fanout. Without a cap, /messages prefetches every
// thread the user belongs to, which on Android WebView can stall the main
// thread for seconds after navigating away.
const PREFETCH_THREAD_CAP = isNativeRuntime() ? 5 : 15;


// Skeleton component for message items while loading
// NOTE: Placeholder name generation was removed - it caused confusion by showing
// fake names like "Casey Walker" when profiles weren't loaded yet.
// Now we show empty string until the real profile is fetched.

// MessagePreview lives in its own module so the memoized ConversationRow can
// share the exact same render path. See: components/chat/MessagePreview.tsx

type Team = InboxTeam;
type Club = InboxClub;

type UnifiedConversation = InboxConversation;

function inboxAuthorizationSnapshot(refs: {
  status: { current: "loading" | "ready" | "failed" };
  teamIds: { current: ReadonlySet<string> };
  clubIds: { current: ReadonlySet<string> };
  groupIds: { current: ReadonlySet<string> };
  dmIds: { current: ReadonlySet<string> };
}): InboxAuthorizationSnapshot {
  return {
    status: refs.status.current,
    teamIds: refs.teamIds.current,
    clubIds: refs.clubIds.current,
    groupIds: refs.groupIds.current,
    dmIds: refs.dmIds.current,
  };
}

export default function MessagesPage() {
  const { user, initialized, refreshUnreadCount } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const { isOnline } = useOnlineStatus();
  usePageTitle("Messages");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [showDMDialog, setShowDMDialog] = useState(false);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [showCustomGroupDialog, setShowCustomGroupDialog] = useState(false);
  const [groupDialogType, setGroupDialogType] = useState<"role" | "team">("role");
  const [showNewMessageSheet, setShowNewMessageSheet] = useState(false);
  const [showGlobalRecap, setShowGlobalRecap] = useState(false);
  const [localClubFilter, setLocalClubFilter] = usePersistedFilter("messages.localClubFilter", "all");
  const [typeFilterRaw, setTypeFilter] = usePersistedFilter("messages.typeFilter", "all");
  // Normalize legacy persisted values ('club' / 'league' used to be top-level
  // chips — they now live inside 'groups').
  const typeFilter = normalizeInboxTypeFilter(typeFilterRaw);
  const [showAllOps, setShowAllOps] = useState(false);
  const [showClubFilterDrawer, setShowClubFilterDrawer] = useState(false);
  const { activeClubFilter, activeClubTeamIds } = useClubTheme();

  // Effective club filter: use theme filter if active, otherwise use local filter
  const effectiveClubFilter = activeClubFilter || (localClubFilter !== "all" ? localClubFilter : null);
  const hasLocalFilter = !activeClubFilter && localClubFilter !== "all";

  // Gate Chat Recap to the active club context so a free active club can't
  // borrow Pro access from another club the user belongs to.
  const { hasAICatchUpClub, recapVisible, resolved: aiCatchUpResolved } = useUserHasAnyAICatchUpClub(effectiveClubFilter ?? null);
  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    let changed = false;
    if (params.get("new") === "picker") {
      setShowNewMessageSheet(true);
      params.delete("new");
      changed = true;
    }
    if (params.get("recap") === "1") {
      if (hasAICatchUpClub) {
        setShowGlobalRecap(true);
      } else {
        toast({ title: "Pro feature", description: "Chat Recap is a Pro feature. Upgrade your club to unlock AI summaries." });
      }
      params.delete("recap");
      changed = true;
    }
    if (changed) {
      navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" }, { replace: true });
    }
  }, [location.search, location.pathname, navigate, hasAICatchUpClub]);

  const { data: clubAdminConversations = [] } = useQuery({
    queryKey: clubAdminInboxQueryKey(user?.id, effectiveClubFilter),
    enabled: !!user && initialized && !useIcpLab,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnMount: "always",
    queryFn: () => fetchClubAdminConversations(user!.id, effectiveClubFilter),
  });

  // Load cached data for instant display
  const cachedData = useMemo(() => {
    if (!user?.id) return null;
    return getCachedMessagesPageData(user.id);
  }, [user?.id]);

  // Phase 1 perf: behind localStorage flag `msg_bootstrap_v1`. When enabled,
  // one RPC seeds the cache for 5 role/permission queries (is-app-admin,
  // is-committee-member, admin-team-ids, user-all-roles, has-any-pro-access)
  // so their existing useQuery blocks become instant cache hits. Rollback:
  // `localStorage.removeItem("msg_bootstrap_v1")`.
  const bootstrapQ = useMessagesPageBootstrap(user?.id, initialized);

  // Inbox perf: mark mount + track bootstrap RPC return + first paint. See
  // src/lib/inboxOpenLatency.ts. Best-effort; one sample per open.
  // We capture per-open timestamps locally because `coldMark` is
  // first-write-wins per JS session — relying on it made every subsequent
  // inbox open report the FIRST open's `bootstrap_ms` / `first_paint_ms`.
  const inboxOpenStartRef = useRef<number>(Date.now());
  const inboxMountTsRef = useRef<number>(Date.now());
  const inboxBootstrapReturnTsRef = useRef<number | null>(null);
  const inboxFirstPaintTsRef = useRef<number | null>(null);
  useEffect(() => {
    const now = Date.now();
    inboxMountTsRef.current = now;
    inboxBootstrapReturnTsRef.current = null;
    inboxFirstPaintTsRef.current = null;
    // For a true cold open, anchor tap_to_paint_ms to the earliest signal we
    // have (notif_tap if it fired, otherwise boot/performance.timeOrigin) so
    // the top-level metric captures the pre-mount prefix (native webview
    // init, auth resolve, chunk fetch, route settle) — not just mount → paint.
    let startTs = now;
    try {
      const snap = snapshotStages();
      if (snap.anchor !== null) {
        const notifTapDelta = snap.deltas.notif_tap;
        if (typeof notifTapDelta === "number") {
          startTs = snap.anchor + notifTapDelta;
        } else if (typeof performance !== "undefined" && performance.timeOrigin) {
          // Prefer timeOrigin (native process start) over the `boot` mark so
          // cold_open captures webview/JS bundle parse time too.
          startTs = Math.min(now, Math.round(performance.timeOrigin));
        } else {
          startTs = snap.anchor;
        }
      }
    } catch {}
    inboxOpenStartRef.current = startTs;
    coldMark("inbox_mount");
    return () => { resetInboxOpenLog(); };
  }, []);
  useEffect(() => {
    if (bootstrapQ.data && inboxBootstrapReturnTsRef.current === null) {
      inboxBootstrapReturnTsRef.current = Date.now();
      coldMark("inbox_bootstrap_return");
    }
  }, [bootstrapQ.data]);



  // Fetch unread message notifications grouped by thread.
  // Uses the shared useUnreadMessageCounts hook so the RPC is deduped across
  // MessagesPage, BottomNav and MyTeamsPremiumCarousel (previously each
  // fetched independently — the #1 slow query in pg_stat_statements).
  const { data: unreadCounts } = useUnreadMessageCounts(user?.id, {
    enabled: initialized && !useIcpLab,
    placeholderData: (prev) => prev,
  });

  // Per-group-chat row badges read from the denormalised `chat_group_unread`
  // cache (realtime-backed). Falls back to `unreadCounts.groups[id]` if the
  // hook hasn't populated yet — so behaviour is identical to the old RPC path
  // in the worst case, and instant in the common case.
  const { data: groupUnreadCache } = useGroupChatUnreadCache(
    initialized && !useIcpLab ? user?.id : null,
  );

  // Delete group mutation (soft-delete so an app admin can restore later)
  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      if (useIcpLab) throw new Error("Group chat deletion is unavailable in ICP lab mode.");
      const { error } = await supabase
        .from("chat_groups")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id ?? null,
        } as any)
        .eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Chat removed. An app admin can restore it if needed." });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
    },
    onError: (error) => {
      toast({
        title: "Error deleting group",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Preview watermarks: the most recent Realtime-accepted inbox preview per
  // scope. Inbox query responses are merged against these so a response that
  // STARTED before a Realtime event can never regress to older/empty preview
  // data (the "preview appears then disappears" defect). Cleared on user
  // change / sign-out below.
  const previewWatermarksRef = useRef(createInboxPreviewWatermarks());
  const previewWatermarks = previewWatermarksRef.current;

  // Fetch member clubs with their latest messages in a single query

  const { data: memberClubsWithMessages, isLoading: memberClubsLoading, isFetched: memberClubsFetched, isFetching: memberClubsFetching, isError: memberClubsError } = useQuery({
    queryKey: ["member-clubs-with-messages", user?.id],
    retry: 3,
    refetchOnReconnect: "always",
    queryFn: () => fetchMemberClubsWithMessages(supabase, user!.id, useIcpLab),
    enabled: !!user && initialized,
    // Warm revisits render instantly from cache; realtime + 30s poll keep
    // previews fresh. Forcing refetch on every mount/focus caused 10-25s
    // freezes when returning to /messages because the N+1 cascade refired.
    staleTime: 30_000,
    initialDataUpdatedAt: 0,
    refetchInterval: jitteredInboxInterval,
    gcTime: 10 * 60 * 1000,
    initialData: cachedData?.memberClubs
      ? { clubs: cachedData.memberClubs as any, latestMessages: cachedData.latestClubMessages ?? {} }
      : undefined,
    placeholderData: (prev) => prev,
  });
  
  // Extract clubs and latest messages from combined query
  const memberClubs = memberClubsWithMessages?.clubs ?? [];
  const latestClubMessages = previewWatermarks.reconcile(
    "club",
    memberClubsWithMessages?.latestMessages as
      | Record<string, InboxPreviewMessage>
      | undefined,
  );

  // Get latest broadcast message
  const { data: latestBroadcast, isFetched: latestBroadcastFetched, isFetching: latestBroadcastFetching, isError: latestBroadcastError } = useQuery({
    queryKey: ["latest-broadcast"],
    refetchOnReconnect: "always",
    queryFn: async () => {
      if (useIcpLab) {
        return null;
      }

      const { data } = await supabase
        .from("broadcast_messages")
        .select("text, created_at, image_url, author_id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (!data) return null;
      
      let authorName = "";
      if (data.author_id) {
        const { data: profile } = await selectCachedProfileById(data.author_id);
        if (profile?.display_name) {
          authorName = profile.display_name;
        }
      }
      
      return {
        text: data.text,
        created_at: data.created_at,
        image_url: data.image_url,
        author_id: data.author_id,
        profiles: { display_name: authorName }
      };
    },
    enabled: !!user && initialized && !useIcpLab,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: true,
    placeholderData: (prev) => prev,
  });


  // Fetch teams with their latest messages in a single query for efficiency
  const { data: teamsWithMessages, isLoading: teamsLoading, isFetched: teamsFetched, isFetching: teamsFetching, isError: teamsError } = useQuery({
    queryKey: ["my-teams-with-messages", user?.id],
    retry: 3,
    refetchOnReconnect: "always",
    queryFn: () => fetchTeamsWithMessages(supabase, user!.id, useIcpLab),
    enabled: !!user && initialized,
    staleTime: 30_000,
    initialDataUpdatedAt: 0,
    refetchInterval: jitteredInboxInterval,
    gcTime: 10 * 60 * 1000,
    initialData: cachedData?.teams
      ? { teams: filterDeletedTeams(cachedData.teams as any) as any, latestMessages: cachedData.latestTeamMessages ?? {} }
      : undefined,
    placeholderData: (prev) => prev,
  });
  
  // Extract teams and latest messages from combined query
  // Locally tombstoned (soft-deleted) teams are dropped at render time too —
  // any cache layer or realtime patch that still holds one can never surface a
  // duplicate/empty thread for a recreated team of the same name.
  const teams = useMemo(
    () => filterDeletedTeams(teamsWithMessages?.teams as any) as typeof teamsWithMessages.teams,
    [teamsWithMessages?.teams],
  );
  const latestTeamMessages = previewWatermarks.reconcile(
    "team",
    teamsWithMessages?.latestMessages,
  );

  const {
    isAppAdmin, isAppAdminFetching, adminClubs, adminTeamIds,
    isCommitteeMember, isCommitteeMemberFetching, userAllRoles, userAllRolesFetching,
    userLeagueIds, userLeagueIdsFetching, hasAnyProAccess, isLoadingProAccess,
    isFetchingProAccess, clubProStatus, isLoadingClubProStatus, isFetchingClubProStatus,
  } = useMessagesPageAccessData({
    client: supabase,
    userId: user?.id,
    initialized,
    useIcpLab,
    memberClubs,
    initialAdminClubs: cachedData?.adminClubs as Club[] | undefined,
  });

  // Fetch chat groups with their latest messages in a single query
  const { data: chatGroupsWithMessages, isLoading: chatGroupsLoading, isFetched: chatGroupsFetched, isFetching: chatGroupsFetching, isError: chatGroupsError } = useQuery({
    queryKey: ["my-chat-groups-with-messages", user?.id],
    refetchOnReconnect: "always",
    queryFn: () => fetchChatGroupsWithMessages(supabase, user!.id),
    enabled: !!user && initialized && !useIcpLab,
    // Matches the sibling inbox queries. The 25s REST GET timeout in
    // `supabaseAuthRetry.ts` otherwise surfaces transient RLS-heavy timeouts
    // as hard errors after a single attempt.
    retry: 3,
    staleTime: 30_000,
    initialDataUpdatedAt: 0,
    refetchInterval: jitteredInboxInterval,
    gcTime: 10 * 60 * 1000,
    initialData: cachedData?.chatGroups
      ? { groups: cachedData.chatGroups as any, latestMessages: cachedData.latestGroupMessages ?? {} }
      : undefined,
    placeholderData: (prev) => prev,
  });
  
  // Extract groups and latest messages from combined query
  const chatGroups = chatGroupsWithMessages?.groups ?? [];
  // Monotonic reconciliation: an older/empty authoritative response that
  // started before a Realtime event must not erase the newer preview.
  const latestGroupMessages = previewWatermarks.reconcile(
    "group",
    chatGroupsWithMessages?.latestMessages,
  );

  // For competition-scoped chat groups, fetch which clubs have entered teams.
  // Used to hide competition chats when the user filters to a club that is
  // not actually participating in that competition.
  const competitionIdsForGroups = useMemo(() => {
    const ids = new Set<string>();
    for (const g of chatGroups as any[]) {
      if (g?.competition_id) ids.add(g.competition_id);
    }
    return Array.from(ids);
  }, [chatGroups]);

  const { data: competitionClubMap } = useQuery({
    queryKey: ["competition-entry-clubs", competitionIdsForGroups],
    enabled: competitionIdsForGroups.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Only ACTIVE participation maps a club into a competition:
      // - the entry must still be accepted (not invited/declined/withdrawn)
      // - the entering team must not be soft-deleted
      // Otherwise stale entries keep a competition's chat groups visible in a
      // club's inbox forever after its teams leave or are deleted.
      const { data, error } = await supabase
        .from("competition_entries")
        .select("competition_id, status, teams!inner(club_id, deleted_at)")
        .in("competition_id", competitionIdsForGroups)
        .eq("status", "accepted")
        .is("teams.deleted_at", null);
      if (error) throw error;
      const map: Record<string, Set<string>> = {};
      for (const row of (data ?? []) as any[]) {
        if (row?.status !== "accepted") continue;
        if (row?.teams?.deleted_at) continue;
        const clubId = row?.teams?.club_id;
        if (!clubId) continue;
        (map[row.competition_id] ||= new Set()).add(clubId);
      }
      return map;
    },
  });


  // Fetch all muted chats for the user
  const { data: mutedChats } = useQuery({
    queryKey: ["muted-chats", user?.id],
    queryFn: () => fetchInboxMutedChats(user!.id, { client: supabase }),
    enabled: !!user && initialized && !useIcpLab,
    staleTime: 60000,
    placeholderData: (prev) => prev,
  });

  // Fetch DM conversations
  const { data: dmConversations, isLoading: dmLoading, isFetching: dmFetching, isFetched: dmFetched, isError: dmError } = useQuery({
    queryKey: ["dm-conversations", user?.id],
    refetchOnReconnect: "always",
    queryFn: () => {
      // Note: session freshness is handled globally by the auth listener /
      // supabaseAuthRetry layer. Awaiting ensureFreshSession() here added
      // 1-3s on cold loads and serialized the DM cascade behind it.
      return fetchDirectMessageConversations({
        client: supabase,
        userId: user!.id,
        cachedData,
        getPreviousConversations: () => queryClient.getQueryData<any[]>(["dm-conversations", user?.id]),
      });
    },
    // Fetch DMs in parallel with everything else; Pro gating happens at
    // render time. Previously this waited on hasAnyProAccess (3 serial
    // queries) before even starting, adding 2-5s to cold loads. RLS still
    // enforces who can read each conversation.
    enabled: !!user && initialized && !useIcpLab,
    staleTime: 30_000,
    initialDataUpdatedAt: 0,
    refetchInterval: jitteredInboxInterval,
    placeholderData: () => {
      if (!cachedData?.dmConversations?.length) return undefined;
      return cachedData.dmConversations.map(conv => ({
        ...conv,
        created_at: (conv as any).created_at || conv.updated_at,
        created_by: (conv as any).created_by || null,
        last_message: cachedData.latestDMMessages?.[conv.id] ? {
          text: cachedData.latestDMMessages[conv.id].text,
          image_url: cachedData.latestDMMessages[conv.id].image_url || null,
          created_at: cachedData.latestDMMessages[conv.id].created_at,
          author_id: cachedData.latestDMMessages[conv.id].author === "You" ? user?.id || "" : conv.other_user?.id || "",
        } : null,
      })) as any;
    },
  });

  // Fetch hidden DM conversations (with hidden_at so they can resurface on new messages)
  const { data: hiddenDMMap } = useQuery({
    queryKey: ["hidden-dm-conversations", user?.id],
    queryFn: () => fetchInboxHiddenDirectMessages(user!.id, supabase),
    enabled: !!user && !useIcpLab,
  });

  // Fetch hidden custom group chats (with hidden_at)
  const { data: hiddenGroupMap } = useQuery({
    queryKey: ["hidden-chat-groups", user?.id],
    queryFn: () => fetchInboxHiddenGroups(user!.id, supabase),
    enabled: !!user && !useIcpLab,
  });

  // Mutation: hide a DM conversation
  const hideDMMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from("hidden_dm_conversations")
        .upsert(
          { user_id: user!.id, conversation_id: conversationId, hidden_at: new Date().toISOString() },
          { onConflict: "user_id,conversation_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hidden-dm-conversations", user?.id] });
      toast({ title: "Conversation hidden", description: "It will reappear when you receive a new message." });
    },
    onError: (e: any) => toast({ title: "Could not hide", description: e?.message || "Try again", variant: "destructive" }),
  });

  // Mutation: hide a custom group chat
  const hideGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from("hidden_chat_groups" as any)
        .upsert(
          { user_id: user!.id, group_id: groupId, hidden_at: new Date().toISOString() },
          { onConflict: "user_id,group_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hidden-chat-groups", user?.id] });
      toast({ title: "Group hidden", description: "It will reappear when someone sends a new message." });
    },
    onError: (e: any) => toast({ title: "Could not hide", description: e?.message || "Try again", variant: "destructive" }),
  });

  // Fetch system messages (welcome message from Ignite Support)
  const { data: systemMessage } = useQuery({
    queryKey: ["system-messages", user?.id],
    queryFn: () => fetchInboxSystemMessage(user!.id, supabase),
    enabled: !!user && !useIcpLab,
  });

  // Cache fresh data when it arrives
  useEffect(() => {
    if (!user?.id) return;
    
    const hasData = teams || memberClubs || adminClubs || chatGroups?.length || latestBroadcast;
    if (!hasData) return;
    
    cacheMessagesPageData(user.id, {
      teams: teams as any,
      memberClubs: memberClubs as any,
      adminClubs: adminClubs as any,
      chatGroups: chatGroups as any,
      latestBroadcast: latestBroadcast as any,
      latestTeamMessages,
      latestClubMessages,
      latestGroupMessages,
    });
  }, [user?.id, teams, memberClubs, adminClubs, chatGroups, latestBroadcast, latestTeamMessages, latestClubMessages, latestGroupMessages]);

  // Prefetch is kept separate from inbox composition so native can suppress
  // speculative work without changing cached conversation/read-model state.
  useInboxThreadPrefetch({
    enabled: !!user,
    queryClient,
    client: supabase,
    teamIds: (teams ?? []).map((team) => team.id),
    clubIds: (memberClubs ?? []).map((club) => club.id),
    groupIds: (chatGroups ?? []).map((group) => group.id),
    cap: PREFETCH_THREAD_CAP,
    messagesPerPage: MESSAGES_PER_PAGE,
    isNativeRuntime,
  });

  // Realtime: keep inbox previews + ordering fresh as new messages arrive.
  // Without this, latest-message text and the most-recent-at-top sort only
  // refresh on the 30s refetchInterval, so new threads don't bubble to the top.
  //
  // IMPORTANT: subscribe ONCE per user (not per teams/clubs/groups identity)
  // to avoid the channel being torn down + rebuilt every 30s when the
  // refetchInterval produces a new array reference. During the resubscribe
  // window incoming INSERTs were being dropped, which is why new messages
  // (including the user's own send) didn't bubble the row to the top until
  // the next 30s poll. We read the latest membership ids via refs.
  const teamIdsRef = useRef<Set<string>>(new Set());
  const clubIdsRef = useRef<Set<string>>(new Set());
  const groupIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { teamIdsRef.current = new Set((teams ?? []).map((t: any) => t.id)); }, [teams]);
  useEffect(() => { clubIdsRef.current = new Set((memberClubs ?? []).map((c: any) => c.id)); }, [memberClubs]);
  useEffect(() => { groupIdsRef.current = new Set((chatGroups ?? []).map((g: any) => g.id)); }, [chatGroups]);

  // Fail-closed authorization set for Realtime callbacks (pass b of Realtime
  // membership audit). We keep the page-driven teams/clubs/groups refs above
  // for perf (they drive UI patching) but layer the authoritative membership
  // snapshot on top: payloads are dropped while status !== 'ready' AND when
  // the scope id is not in the authorized set. Empty set + ready => user has
  // no access to that scope => drop (previous `ids.size && !ids.has(x)` guard
  // failed open on empty).
  const authScopes = useAuthorizedScopes();
  const authStatusRef = useRef(authScopes.status);
  const authTeamIdsRef = useRef<ReadonlySet<string>>(authScopes.teamIds);
  const authClubIdsRef = useRef<ReadonlySet<string>>(authScopes.clubIds);
  const authGroupIdsRef = useRef<ReadonlySet<string>>(authScopes.groupIds);
  const authDmIdsRef = useRef<ReadonlySet<string>>(authScopes.dmConversationIds);
  useEffect(() => {
    authStatusRef.current = authScopes.status;
    authTeamIdsRef.current = authScopes.teamIds;
    authClubIdsRef.current = authScopes.clubIds;
    authGroupIdsRef.current = authScopes.groupIds;
    authDmIdsRef.current = authScopes.dmConversationIds;
  }, [authScopes]);

  // Payloads that arrive before the membership snapshot resolves used to be
  // dropped outright, which meant the first seconds after opening /messages
  // could silently lose the newest message until the next poll. Both channels
  // now hand every event to a coordinator that buffers (bounded) until
  // `status === 'ready'` and then replays exactly once. Authorization stays
  // fail-closed: the replay runs the same `isAuthorized` check.
  //
  // `attemptFlush()` is idempotent and called from BOTH sides of the race —
  // here when authorization becomes ready, and inside the channel effects when
  // the applier is installed — so whichever happens last performs the flush.
  const webInboxCoordinatorRef = useRef(
    createInboxRealtimeCoordinator({ isReady: () => authStatusRef.current === "ready" }),
  );
  const nativeInboxCoordinatorRef = useRef(
    createInboxRealtimeCoordinator({ isReady: () => authStatusRef.current === "ready" }),
  );
  const webInboxCoordinator = webInboxCoordinatorRef.current;
  const nativeInboxCoordinator = nativeInboxCoordinatorRef.current;

  useEffect(() => {
    if (authScopes.status === "ready") {
      webInboxCoordinator.attemptFlush();
      nativeInboxCoordinator.attemptFlush();
      return;
    }
    if (authScopes.status === "failed") {
      // Authorization could not be established — discard buffered events
      // rather than risk applying them later against unknown scopes.
      webInboxCoordinator.clear();
      nativeInboxCoordinator.clear();
      previewWatermarks.clear();
    }
  }, [authScopes.status, webInboxCoordinator, nativeInboxCoordinator, previewWatermarks]);

  // Sign-out / user switch: no buffered event or preview watermark from the
  // previous user may survive into the next session.
  useEffect(() => {
    return () => {
      webInboxCoordinator.clear();
      nativeInboxCoordinator.clear();
      previewWatermarks.clear();
    };
  }, [user?.id, webInboxCoordinator, nativeInboxCoordinator, previewWatermarks]);




  useEffect(() => {
    if (!user?.id) return;

    // HARD-STOP PERF GUARD (native): the inbox realtime fanout was the single
    // largest source of long-task storms / 26s freezes on Android WebView.
    // Every INSERT to team/club/group/dm/broadcast tables would invalidate
    // 1-2 large queries AND the unread-counts query, which on accounts with
    // many threads chained dozens of long tasks together and froze the UI.
    //
    // On native we now rely on:
    //   - 30s refetchInterval on each query
    //   - foreground resume + reconnect refetches (reactQueryNativeAdapter)
    //   - pull-to-refresh
    //   - opening a thread (the thread itself stays fully realtime)
    // Web still gets the live channel.
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
    // Native uses a separate, lightweight realtime block (below) that patches
    // react-query caches in place via setQueryData — no invalidations, no
    // refetch storm, no localStorage rewrites on the hot path. The freeze on
    // /messages came from invalidateQueries chaining 4-6 parallel refetches
    // that each parsed/merged/restringified the 100-500KB messages-page cache
    // blob. Patching the in-memory query data directly lets previews stay
    // live without any of that work.
    if (isNative) return;

    const rafState = { team: 0, club: 0, group: 0, dm: 0, unread: 0 } as Record<string, number>;
    const schedule = (key: keyof typeof rafState, fn: () => void) => {
      if (rafState[key]) return;
      rafState[key] = requestAnimationFrame(() => { rafState[key] = 0; fn(); });
    };
    const bumpUnread = () => schedule('unread', () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.messageUnreadFor(user.id) });
    });

    // Web: patch the latestMessages cache IN PLACE so the preview text updates
    // instantly (same trick the native channel uses below). Without this, the
    // unread badge appears immediately (cheap COUNT RPC) but the preview text
    // sits stale for seconds waiting on the heavier join RPC. The invalidate
    // still runs afterward to backfill author display name + reconcile.
    const previewAuthor = (authorId?: string) => {
      if (!authorId) return "";
      if (authorId === user.id) return "You";
      const cached = getProfileFromCache(authorId);
      return cached?.display_name || "";
    };
    const patchLatest = (
      key: any[],
      scope: 'team' | 'club' | 'group',
      targetId: string,
      row: any,
      extra: Record<string, any> = {},
    ) => {
      const cached = queryClient.getQueryData<any>(key);
      const prev = cached?.latestMessages?.[targetId];
      const preview = buildRealtimePreview(
        row,
        extra.author || previewAuthor(row.author_id) || (prev?.author ?? ""),
        extra,
      );

      // This handler is reached only after the final fail-closed scope check.
      // Record the exact object written to React Query so a stale response from
      // the invalidation below cannot erase the accepted Realtime preview.
      previewWatermarks.note(`${scope}:${targetId}`, preview);
      queryClient.setQueryData(key, (old: any) => mergeLatestMessagesPreview(old, targetId, preview, { createIfMissing: true }));
    };

    // Fail-closed filters — drop payload unless membership snapshot is `ready`
    // AND the scope id is in the authorized set. Empty set + ready => user
    // has no access to that kind => drop.
    const isAuthorized = (kind: 'team' | 'club' | 'group' | 'dm', id: string | null | undefined): boolean =>
      isAuthorizedInboxScope(kind, id, inboxAuthorizationSnapshot({
        status: authStatusRef,
        teamIds: authTeamIdsRef,
        clubIds: authClubIdsRef,
        groupIds: authGroupIdsRef,
        dmIds: authDmIdsRef,
      }));

    const handlers: Record<string, (payload: any) => void> = {
      team_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('team', row?.team_id)) return;
        const isAnnouncement = !!(row.is_club_announcement && row.club_announcement_name);
        patchLatest(["my-teams-with-messages", user.id], 'team', row.team_id, row, {
          author: isAnnouncement ? row.club_announcement_name : previewAuthor(row.author_id),
          is_announcement: isAnnouncement,
        });
        schedule('team', () => queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages", user.id] }));
        bumpUnread();
      },
      club_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('club', row?.club_id)) return;
        patchLatest(["member-clubs-with-messages", user.id], 'club', row.club_id, row);
        schedule('club', () => queryClient.invalidateQueries({ queryKey: ["member-clubs-with-messages", user.id] }));
        bumpUnread();
      },
      group_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('group', row?.group_id)) return;
        patchLatest(["my-chat-groups-with-messages", user.id], 'group', row.group_id, row);
        schedule('group', () => queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages", user.id] }));
        bumpUnread();
      },
      direct_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('dm', row?.conversation_id)) return;
queryClient.setQueryData(["dm-conversations", user.id], (old: any[] | undefined) => moveDirectConversationToTop(old, row));
        schedule('dm', () => queryClient.invalidateQueries({ queryKey: ["dm-conversations", user.id] }));
        bumpUnread();
      },
      broadcast_messages: (payload: any) => {
        // Broadcasts have no scope id — RLS on `broadcast_messages` already
        // decides who receives them. Still gate on `ready` so we don't act
        // on a stale channel after sign-out.
        if (authStatusRef.current !== 'ready') return;
        const row = payload.new;
        queryClient.setQueryData(["latest-broadcast"], (old: any) => ({
          text: row.text ?? '',
          created_at: row.created_at,
          image_url: row.image_url ?? null,
          profiles: old?.profiles ?? null,
        }));
        queryClient.invalidateQueries({ queryKey: ["latest-broadcast"] });
        bumpUnread();
      },
    };

    // Edits (UPDATE) never fired here before, so an edited message kept its
    // ORIGINAL text in every inbox preview until the next cold refetch.
    // Reconcile by refetching the affected list (edits are rare, so this can't
    // contribute to invalidation storms) — no unread bump, edits aren't new mail.
    const editHandlers: Record<string, (payload: any) => void> = {
      team_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('team', row?.team_id)) return;
        schedule('team', () => queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages", user.id] }));
      },
      club_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('club', row?.club_id)) return;
        schedule('club', () => queryClient.invalidateQueries({ queryKey: ["member-clubs-with-messages", user.id] }));
      },
      group_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('group', row?.group_id)) return;
        schedule('group', () => queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages", user.id] }));
      },
      direct_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('dm', row?.conversation_id)) return;
        schedule('dm', () => queryClient.invalidateQueries({ queryKey: ["dm-conversations", user.id] }));
      },
      broadcast_messages: () => {
        if (authStatusRef.current !== 'ready') return;
        queryClient.invalidateQueries({ queryKey: ["latest-broadcast"] });
      },
    };

    // Buffer-then-replay via the shared inbox coordinator: while the
    // membership snapshot is still loading we hold payloads (bounded) instead
    // of discarding them, and replay them through these same authorized
    // handlers once scopes resolve.
    const applyEvent = (event: InboxRealtimeEvent) => {
      if (event.kind === 'edit') editHandlers[event.table]?.(event.payload);
      else handlers[event.table]?.(event.payload);
    };
    webInboxCoordinator.setApplier(applyEvent);
    const dispatch = (table: string, payload: any, kind: 'insert' | 'edit' = 'insert') => {
      webInboxCoordinator.dispatch({ table, payload, kind });
    };


    const channel = supabase
      .channel(`messages-inbox-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, (p: any) => dispatch('team_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'club_messages' }, (p: any) => dispatch('club_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, (p: any) => dispatch('group_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (p: any) => dispatch('direct_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast_messages' }, (p: any) => dispatch('broadcast_messages', p))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'team_messages' }, (p: any) => dispatch('team_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'club_messages' }, (p: any) => dispatch('club_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_messages' }, (p: any) => dispatch('group_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages' }, (p: any) => dispatch('direct_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'broadcast_messages' }, (p: any) => dispatch('broadcast_messages', p, 'edit'))
      .subscribe();


    // Register with the realtime channel registry so it's torn down on
    // membership revocation / sign-out via `revokeAllForUser`.
    const unregister = registerChannel({
      key: `messages-inbox-${user.id}`,
      channel,
      userId: user.id,
      scope: { kind: 'user', id: user.id },
    });

    return () => {
      unregister();
      webInboxCoordinator.setApplier(null);
      webInboxCoordinator.clear();
      Object.keys(rafState).forEach((k) => { if (rafState[k]) cancelAnimationFrame(rafState[k]); });
    };
  }, [user?.id, queryClient]);

  // Native-only: lightweight realtime that PATCHES react-query caches in
  // place instead of invalidating them. This keeps inbox previews live
  // (latest text, image hint, bubble-to-top sort) without triggering the
  // refetch storm + cache rewrites that froze Android WebView for 11-26s.
  // No unread-count bump here — counts refresh on 30s poll, foreground
  // resume, reconnect, and on opening the thread.
  useEffect(() => {
    if (!user?.id) return;
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
    if (!isNative) return;

    // Resolve an author display name without ever invalidating react-query.
    // 1) "You" if it's the current user.
    // 2) profileCache hit (sync, in-memory).
    // 3) Queue the id; a coalesced batch lookup runs every 500ms and
    //    re-patches the affected preview rows when names arrive.
    type PendingTarget = { kind: 'team' | 'club' | 'group' | 'dm'; targetId: string };
    const pendingByAuthor = new Map<string, PendingTarget[]>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const patchAuthor = (kind: PendingTarget['kind'], targetId: string, authorName: string) => {
      const apply = (key: any[], idKey: string) => {
        queryClient.setQueryData(key, (old: any) => {
          if (!old?.latestMessages?.[targetId]) return old;
          if (old.latestMessages[targetId].author === authorName) return old;
          return {
            ...old,
            latestMessages: {
              ...old.latestMessages,
              [targetId]: { ...old.latestMessages[targetId], author: authorName },
            },
          };
        });
      };
      if (kind === 'team') apply(["my-teams-with-messages", user.id], 'team_id');
      else if (kind === 'club') apply(["member-clubs-with-messages", user.id], 'club_id');
      else if (kind === 'group') apply(["my-chat-groups-with-messages", user.id], 'group_id');
      else if (kind === 'dm') {
        queryClient.setQueryData(["dm-conversations", user.id], (old: any[] | undefined) => {
          if (!Array.isArray(old)) return old;
          const idx = old.findIndex((c: any) => c.id === targetId);
          if (idx === -1) return old;
          const conv = old[idx];
          if (conv?.other_user?.display_name === authorName) return old;
          const next = old.slice();
          next[idx] = { ...conv, other_user: { ...(conv.other_user || { id: '' }), display_name: authorName } };
          return next;
        });
      }
    };

    const flushPending = async () => {
      flushTimer = null;
      if (pendingByAuthor.size === 0) return;
      const ids = Array.from(pendingByAuthor.keys());
      const batch = new Map(pendingByAuthor);
      pendingByAuthor.clear();
      try {
        const { data } = await selectCachedProfilesByIds(ids);
        if (data && data.length) cacheProfiles(data);
        const byId = new Map((data ?? []).map(p => [p.id, p.display_name || ""]));
        batch.forEach((targets, authorId) => {
          const name = byId.get(authorId);
          if (!name) return;
          targets.forEach(t => patchAuthor(t.kind, t.targetId, name));
        });
      } catch { /* silent — next 30s poll will fill it in */ }
    };

    const queueAuthor = (authorId: string, target: PendingTarget) => {
      const list = pendingByAuthor.get(authorId) ?? [];
      list.push(target);
      pendingByAuthor.set(authorId, list);
      if (!flushTimer) flushTimer = setTimeout(flushPending, 500);
    };

    const resolveAuthor = (authorId: string | undefined, target: PendingTarget): string => {
      if (!authorId) return "";
      if (authorId === user.id) return "You";
      const cached = getProfileFromCache(authorId);
      if (cached?.display_name) return cached.display_name;
      queueAuthor(authorId, target);
      return ""; // placeholder — patched in <500ms once batch resolves
    };

    // Lightweight unread bump: in-place setQueryData on the unread-counts
    // cache, no invalidation (which would re-run the expensive RPC fanout
    // and re-freeze Android WebView). Skips own messages and the currently
    // open thread so badges don't flash.
    const bumpUnread = (
      kind: 'team' | 'club' | 'group' | 'dm' | 'broadcast',
      targetId: string | null,
      authorId?: string,
    ) => {
      if (authorId && authorId === user.id) return;
      const path = window.location.pathname;
      if (kind === 'team' && targetId && path === `/messages/${targetId}`) return;
      if (kind === 'club' && targetId && path === `/messages/club/${targetId}`) return;
      if (kind === 'group' && targetId && path === `/groups/${targetId}`) return;
      if (kind === 'dm' && targetId && path === `/messages/dm/${targetId}`) return;
      if (kind === 'broadcast' && path === '/messages/broadcast') return;
      queryClient.setQueryData(notificationKeys.messageUnreadFor(user.id), (old: any) => {
        if (!old) return old;
        if (kind === 'broadcast') return { ...old, broadcast: (old.broadcast ?? 0) + 1 };
        if (!targetId) return old;
        const bucket =
          kind === 'team' ? 'teams' :
          kind === 'club' ? 'clubs' :
          kind === 'group' ? 'groups' : 'dms';
        const map = { ...(old[bucket] || {}) };
        map[targetId] = (map[targetId] ?? 0) + 1;
        return { ...old, [bucket]: map };
      });
    };

    // Fail-closed authorization filter (native-light channel).
    const isAuthorized = (kind: 'team' | 'club' | 'group' | 'dm', id: string | null | undefined): boolean =>
      isAuthorizedInboxScope(kind, id, inboxAuthorizationSnapshot({
        status: authStatusRef,
        teamIds: authTeamIdsRef,
        clubIds: authClubIdsRef,
        groupIds: authGroupIdsRef,
        dmIds: authDmIdsRef,
      }));

    const patchNativeLatest = (
      key: any[],
      scope: 'team' | 'club' | 'group',
      targetId: string,
      row: any,
      author: string,
      extra: Record<string, any> = {},
    ) => {
      const cached = queryClient.getQueryData<any>(key);
      const preview = buildRealtimePreview(row, author || (cached?.latestMessages?.[targetId]?.author ?? ""), extra);
      previewWatermarks.note(`${scope}:${targetId}`, preview);
      queryClient.setQueryData(key, (old: any) => mergeLatestMessagesPreview(old, targetId, preview));
    };

    const handlers: Record<string, (payload: any) => void> = {
      team_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('team', row?.team_id)) return;
        const isAnnouncement = !!(row.is_club_announcement && row.club_announcement_name);
        patchNativeLatest(
          ["my-teams-with-messages", user.id],
          'team',
          row.team_id,
          row,
          isAnnouncement ? row.club_announcement_name : resolveAuthor(row.author_id, { kind: 'team', targetId: row.team_id }),
          { is_announcement: isAnnouncement },
        );
        bumpUnread('team', row.team_id, row.author_id);
      },
      club_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('club', row?.club_id)) return;
        patchNativeLatest(
          ["member-clubs-with-messages", user.id],
          'club',
          row.club_id,
          row,
          resolveAuthor(row.author_id, { kind: 'club', targetId: row.club_id }),
        );
        bumpUnread('club', row.club_id, row.author_id);
      },
      group_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('group', row?.group_id)) return;
        patchNativeLatest(
          ["my-chat-groups-with-messages", user.id],
          'group',
          row.group_id,
          row,
          resolveAuthor(row.author_id, { kind: 'group', targetId: row.group_id }),
        );
        bumpUnread('group', row.group_id, row.author_id);
      },
      direct_messages: (payload: any) => {

        const row = payload.new;
        if (!isAuthorized('dm', row?.conversation_id)) return;
queryClient.setQueryData(["dm-conversations", user.id], (old: any[] | undefined) => moveDirectConversationToTop(old, row));
        const convs = queryClient.getQueryData<any[]>(["dm-conversations", user.id]);
        const conv = convs?.find(c => c.id === row.conversation_id);
        const otherId = conv?.other_user?.id
          ?? (conv?.participant_1 === user.id ? conv?.participant_2 : conv?.participant_1);
        if (otherId && otherId !== user.id && !conv?.other_user?.display_name) {
          resolveAuthor(otherId, { kind: 'dm', targetId: row.conversation_id });
        }
        bumpUnread('dm', row.conversation_id, row.author_id);
      },
      broadcast_messages: (payload: any) => {

        if (authStatusRef.current !== 'ready') return;
        const row = payload.new;
        queryClient.setQueryData(["latest-broadcast"], (old: any) => ({
          text: row.text ?? '',
          created_at: row.created_at,
          image_url: row.image_url ?? null,
          profiles: old?.profiles ?? null,
        }));
        bumpUnread('broadcast', null);
      },
    };

    // Native edit handling: patch the preview text in place when the edited
    // row IS the currently previewed latest message (matched on created_at).
    // Previously UPDATE events were never subscribed, so an edited message
    // kept showing its original text in the inbox.
    const patchEditedPreview = (
      key: any[],
      scope: 'team' | 'club' | 'group',
      targetId: string,
      row: any,
    ) => {
      queryClient.setQueryData(key, (old: any) => {
        const prev = old?.latestMessages?.[targetId];
        if (!prev || prev.created_at !== row.created_at) return old;
        const next = { ...prev, text: row.text ?? '', image_url: row.image_url ?? null };
        // Keep the watermark in step so a later stale response can't restore
        // the pre-edit text.
        previewWatermarks.note(`${scope}:${targetId}`, next);
        return {
          ...old,
          latestMessages: {
            ...old.latestMessages,
            [targetId]: next,
          },
        };
      });
    };

    const editHandlers: Record<string, (payload: any) => void> = {
      team_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('team', row?.team_id)) return;
        patchEditedPreview(["my-teams-with-messages", user.id], 'team', row.team_id, row);
      },
      club_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('club', row?.club_id)) return;
        patchEditedPreview(["member-clubs-with-messages", user.id], 'club', row.club_id, row);
      },
      group_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('group', row?.group_id)) return;
        patchEditedPreview(["my-chat-groups-with-messages", user.id], 'group', row.group_id, row);
      },
      direct_messages: (payload: any) => {
        const row = payload.new;
        if (!isAuthorized('dm', row?.conversation_id)) return;
queryClient.setQueryData(["dm-conversations", user.id], (old: any[] | undefined) => patchDirectConversationEdit(old, row));
      },
      broadcast_messages: (payload: any) => {
        if (authStatusRef.current !== 'ready') return;
        const row = payload.new;
        queryClient.setQueryData(["latest-broadcast"], (old: any) => {
          if (!old || old.created_at !== row.created_at) return old;
          return { ...old, text: row.text ?? '', image_url: row.image_url ?? null };
        });
      },
    };


    // Buffering + exactly-once application is owned by the shared inbox
    // coordinator: events arriving before the membership snapshot resolves are
    // held (bounded) and replayed once scopes are `ready`. Fail-closed is
    // preserved — the replay runs the same `isAuthorized` check below.
    const applyEvent = (event: InboxRealtimeEvent) => {
      if (event.kind === 'edit') editHandlers[event.table]?.(event.payload);
      else handlers[event.table]?.(event.payload);
    };
    nativeInboxCoordinator.setApplier(applyEvent);
    const dispatch = (table: string, payload: any, kind: 'insert' | 'edit' = 'insert') => {
      nativeInboxCoordinator.dispatch({ table, payload, kind });
    };


    const channel = supabase
      .channel(`messages-inbox-light-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, (p: any) => dispatch('team_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'club_messages' }, (p: any) => dispatch('club_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, (p: any) => dispatch('group_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (p: any) => dispatch('direct_messages', p))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast_messages' }, (p: any) => dispatch('broadcast_messages', p))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'team_messages' }, (p: any) => dispatch('team_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'club_messages' }, (p: any) => dispatch('club_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_messages' }, (p: any) => dispatch('group_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages' }, (p: any) => dispatch('direct_messages', p, 'edit'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'broadcast_messages' }, (p: any) => dispatch('broadcast_messages', p, 'edit'))
      .subscribe();

    const unregister = registerChannel({
      key: `messages-inbox-light-${user.id}`,
      channel,
      userId: user.id,
      scope: { kind: 'user', id: user.id },
    });

    return () => {
      unregister();
      if (flushTimer) clearTimeout(flushTimer);
      // Channel teardown: the applier closes over this effect's handlers, so
      // it must not outlive them. Buffered events are dropped with it.
      nativeInboxCoordinator.setApplier(null);
      nativeInboxCoordinator.clear();
    };

  }, [user?.id, queryClient]);

  // Force-refresh inbox previews on mount and whenever the page becomes
  // visible again. The realtime channels above can miss inserts while the
  // tab/app was backgrounded (especially on Android WebView), leaving the
  // unread badge correctly bumped by the notifications channel but the
  // preview text stuck on an older message. A cheap RPC refetch on visibility
  // brings the latest-message text in sync with the unread badge.
  useEffect(() => {
    if (!user?.id) return;
    const refreshPreviews = () => {
      // Dripped in bounded batches rather than 6 concurrent N+1 cascades —
      // firing them all at once saturated the Android WebView connection pool
      // and froze the inbox. See src/lib/chatInvalidationQueue.ts.
      queueChatInvalidation(queryClient, [
        ["my-teams-with-messages", user.id],
        ["member-clubs-with-messages", user.id],
        ["my-chat-groups-with-messages", user.id],
        ["dm-conversations", user.id],
        ["latest-broadcast"],
        notificationKeys.messageUnreadFor(user.id),
      ]);
    };

    // Run once on mount so the cached preview is reconciled with the server.
    refreshPreviews();
    // NATIVE: `reactQueryNativeAdapter` is the single owner of foreground
    // recovery (it refetches active queries on appStateChange). Running this
    // six-query invalidation batch as well produced overlapping refresh
    // storms that saturated the Android WebView main thread — the inbox
    // rendered but taps on conversation rows did nothing until force-quit.
    // Web/PWA keeps the visibility refresh since it has no native adapter.
    if (isNativeRuntime()) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshPreviews();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [user?.id, queryClient]);




  // Check if we have cached data to show immediately
  const hasCachedData = cachedData && (
    cachedData.teams?.length > 0 || 
    cachedData.memberClubs?.length > 0 || 
    cachedData.chatGroups?.length > 0
  );

  const hasAnyDisplayData = !!(teams?.length || memberClubs?.length || chatGroups?.length);
  const isLoadingFreshData = !hasAnyDisplayData && !hasCachedData && !!(teamsLoading || memberClubsLoading || chatGroupsLoading || isLoadingClubProStatus);
  // Wait for fresh latest-message data before sorting/rendering, so the most
  // recent thread is at the top on first paint (cached `lastActivity` may be
  // stale). We keep this gate even when cached data exists — otherwise the
  // cached order paints first and threads visibly shuffle once fresh
  // `lastActivity` timestamps arrive.
  // NOTE: Pro access is intentionally excluded — it's 4 serial DB trips and
  // would block first paint 200–800ms without affecting sort order. DM thread
  // visibility is the only thing it gates, and DMs settle into the already-
  // rendered list in-place (no re-sort jump) because they sort by their own
  // lastActivity alongside the rest.
  // Treat errored queries as "settled" — otherwise a network drop during the
  // initial load leaves `isFetched` false forever, and the inbox is stuck on
  // the skeleton even after coverage returns. The errored query will retry
  // on reconnect (refetchOnReconnect: "always") and rehydrate in place.
  // Offline: never wait on remote queries — they can't resolve without a
  // network, and the user-scoped cache is the authoritative thing to show.
  //
  // NATIVE STALE-ORDER FIX: `initialData` (from the user-scoped inbox cache)
  // makes React Query report `isFetched === true` before the network round
  // trip returns, so the old gate released on cached `lastActivity` values and
  // the rows visibly re-sorted a moment later. Requiring `!isFetching` as well
  // means the first reveal always happens on server-authoritative ordering.
  // Errored queries still settle (isFetching flips false), and offline/paused
  // queries also report `isFetching === false`, so neither can wedge the gate.
  const sortSourcesSettled =
    (teamsFetched || teamsError) && !teamsFetching &&
    (memberClubsFetched || memberClubsError) && !memberClubsFetching &&
    (chatGroupsFetched || chatGroupsError) && !chatGroupsFetching &&
    (latestBroadcastFetched || latestBroadcastError) && !latestBroadcastFetching &&
    (dmFetched || dmError) && !dmFetching;

  // Hard ceiling: never hold the skeleton longer than this, even if one query
  // is pathologically slow. Order may correct in place after this point, but
  // the inbox is guaranteed to paint.
  const [sortGateExpired, setSortGateExpired] = useState(false);
  useEffect(() => {
    if (sortSourcesSettled) return;
    const t = window.setTimeout(() => setSortGateExpired(true), 3500);
    return () => window.clearTimeout(t);
  }, [sortSourcesSettled]);

  // `freshSortDataReady` describes *initial ordering readiness only*.
  const freshSortDataReady = !isOnline || sortSourcesSettled || sortGateExpired;

  // FIRST-REVEAL LATCH.
  // `sortSourcesSettled` depends on `isFetching`, which flips true again for
  // every ordinary background/Realtime refetch. Using it directly as the
  // permanent render decision made the whole inbox collapse back to the
  // full-page skeleton after resume or when a new message arrived. The
  // ordering gate must therefore apply *only until* the first settled reveal;
  // afterwards refetching is non-blocking and rows are patched in place.
  const hasRevealedStableInboxRef = useRef(sessionRevealedInboxUserId === user?.id && !!user?.id);
  const [hasRevealedStableInbox, setHasRevealedStableInbox] = useState(hasRevealedStableInboxRef.current);

  // Reset only on a genuine identity change (a new mount starts false anyway).
  const revealLatchIdentityRef = useRef<string | undefined>(user?.id);
  if (revealLatchIdentityRef.current !== user?.id) {
    revealLatchIdentityRef.current = user?.id;
    hasRevealedStableInboxRef.current = sessionRevealedInboxUserId === user?.id && !!user?.id;
  }

  // WARM-MOUNT CACHE FIX. The ordering gate must only ever apply to the very
  // first inbox reveal of the session. Previously the latch lived in a mount
  // ref, so every warm re-entry to /messages started false again — and because
  // the inbox queries use `refetchOnMount`, `isFetching` was true on that mount,
  // which held the full-page skeleton and ignored the cached rows we already
  // had. The latch is now session-scoped per user, so warm re-entry paints from
  // cache immediately and patches in place.
  //
  // STALE-ORDER FIX: the cached-data bypass must NOT also be applied to the
  // session's *first* reveal. Cached rows carry stale `lastActivity` /
  // `created_at` values, so releasing the gate merely because a cache exists
  // painted an intermediate ordering that visibly re-sorted the moment the
  // authoritative previews arrived (the Android reload/resume jolt). Online
  // cold starts therefore wait for authoritative ordering, bounded by
  // `sortGateExpired` (and `isLoadingFreshData` still consults the cache, so
  // a cached inbox never waits on the *loading* half of the gate). Offline is
  // excluded entirely by the leading `isOnline`, so the cached inbox is still
  // revealed instantly with no network.
  const initialRevealBlocked =
    isOnline &&
    (isLoadingFreshData || !freshSortDataReady);


  useEffect(() => {
    if (hasRevealedStableInboxRef.current) return;
    if (initialRevealBlocked) return;
    hasRevealedStableInboxRef.current = true;
    if (user?.id) sessionRevealedInboxUserId = user.id;
    setHasRevealedStableInbox(true);
  }, [initialRevealBlocked, user?.id]);

  useEffect(() => {
    if (hasRevealedStableInbox && !hasRevealedStableInboxRef.current) {
      setHasRevealedStableInbox(false);
    }
  }, [hasRevealedStableInbox, user?.id]);

  const showSkeletonLoading = isOnline && !hasRevealedStableInboxRef.current && initialRevealBlocked;




  // Resume/reconnect stability: an inbox source query can transiently resolve
  // to undefined/[] while it is refetching or errored (auth refresh, RLS
  // settling, dropped socket). Retain the last non-empty result until the query
  // settles successfully — a settled empty result is still authoritative, so
  // removed/purged conversations do not linger.
  // A successful empty `user_roles` response can be a transient false-negative
  // while the native auth token is rotating on resume. The independently
  // resolved bootstrap membership list corroborates whether that empty result
  // is authoritative before we release a retained team snapshot.
  const teamsEmptyCorroborated =
    teams.length > 0 ||
    !bootstrapQ.data ||
    bootstrapQ.data.member_team_ids.length === 0;
  const stickyTeams = useStickyList<any>(teams, {
    isFetching: teamsFetching,
    isFetched: teamsFetched && teamsEmptyCorroborated,
    isError: teamsError,
    resetKey: user?.id ?? null,
  });
  const stickyMemberClubs = useStickyList<any>(memberClubs, {
    isFetching: memberClubsFetching,
    isFetched: memberClubsFetched,
    isError: memberClubsError,
    resetKey: user?.id ?? null,
  });
  const stickyChatGroups = useStickyList<any>(chatGroups, {
    isFetching: chatGroupsFetching,
    isFetched: chatGroupsFetched,
    isError: chatGroupsError,
    resetKey: user?.id ?? null,
  });

  // Determine which data to display (prefer fresh, fallback to cached).
  // Cached rows are also used while a source query has not yet completed its
  // first fetch for this mount (`!isFetched`) — that's what makes a warm inbox
  // open paint instantly instead of showing an empty list. A *settled* empty
  // online result stays authoritative.
  const displayTeams = (stickyTeams?.length ? stickyTeams : ((!isOnline || !teamsFetched) ? (cachedData?.teams as any) : null)) || stickyTeams || cachedData?.teams || [];
  const displayMemberClubs = (stickyMemberClubs?.length ? stickyMemberClubs : ((!isOnline || !memberClubsFetched) ? (cachedData?.memberClubs as any) : null)) || stickyMemberClubs || cachedData?.memberClubs || [];
  const displayAdminClubs = adminClubs || cachedData?.adminClubs || [];
  // Important: an empty fresh chat-group result is authoritative *while
  // online*. Falling back to cached groups when `chatGroups.length === 0`
  // kept soft-deleted/purged club chats visible forever after the server
  // correctly returned no rows. Offline, an empty/failed result carries no
  // authority, so cached rows stay visible.
  const allChatGroups = (stickyChatGroups?.length ? stickyChatGroups : ((!isOnline || !chatGroupsFetched) ? (cachedData?.chatGroups as any) : null)) ?? stickyChatGroups ?? (cachedData?.chatGroups as any) ?? [];


  
  // Filter chat groups by user's roles
  const displayChatGroups = useMemo(() => {
    if (isAppAdmin || isCommitteeMember) return allChatGroups;

    // Offline with no roles loaded: the cached groups were already RLS- and
    // role-filtered for THIS user when they were written (cache is
    // user-scoped and cleared on sign-out), so render them rather than
    // dropping every club/team chat.
    const rolesUnavailableOffline = !isOnline && !userAllRoles?.length;
    if (rolesUnavailableOffline) return allChatGroups;

    return allChatGroups.filter((group: any) => {
      // Personal/custom groups (no club, team, or mini-league scope) are
      // membership-based via group_members and RLS already filtered them.
      // Always show them — do NOT gate on user_roles.
      const isPersonalGroup = !group.club_id && !group.team_id && !group.mini_league_id;
      if (isPersonalGroup) return true;

      if (!userAllRoles?.length) return false;


      const allowedRoles: string[] = group.allowed_roles || [];
      if (allowedRoles.length === 0) return true;

      if (group.mini_league_id) {
        const isLeagueAdmin = userAllRoles.some((ur: any) => 
          ["club_admin", "league_admin", "coach", "team_admin"].includes(ur.role) && 
          ur.club_id === group.club_id
        );
        if (isLeagueAdmin) return true;
        if (!userLeagueIds?.has(group.mini_league_id)) return false;
      }
      
      return userAllRoles.some((ur: any) => {
        if (!allowedRoles.includes(ur.role)) return false;
        if (group.club_id && !group.team_id && !group.mini_league_id) {
          return ur.club_id === group.club_id;
        }
        if (group.team_id) {
          return ur.team_id === group.team_id;
        }
        return true;
      });
    });
  }, [allChatGroups, userAllRoles, userLeagueIds, isAppAdmin, isCommitteeMember, isOnline]);

  const displayLatestBroadcast = latestBroadcast || cachedData?.latestBroadcast;
  const displayLatestTeamMessages = latestTeamMessages || {};
  const displayLatestClubMessages = latestClubMessages || {};
  const displayLatestGroupMessages = latestGroupMessages || {};

  const displayClubsWithAnnouncements = displayMemberClubs;

  const canCreateGroups = (adminTeamIds?.length || adminClubs?.length || isAppAdmin || isCommitteeMember) && (hasAnyProAccess || isAppAdmin);

  // Filter all items based on search query and active club filter
  const query = normalizeInboxSearchQuery(searchQuery);

  // Separate league chats from regular chat groups
  const { leagueChats, regularChatGroups } = useMemo(
    () => partitionInboxGroups(displayChatGroups),
    [displayChatGroups],
  );

  // Personal/custom groups (membership-based, no club/team/league/competition scope).
  const personalGroupIds = useMemo(
    () => collectPersonalGroupIds(regularChatGroups),
    [regularChatGroups],
  );

  // Other-user ids across all DM conversations (used to test club membership).
  const dmOtherUserIds = useMemo(
    () => collectDirectMessagePeerIds(dmConversations ?? [], user?.id),
    [dmConversations, user?.id],
  );

  // When a club filter is active, look up which DM peers and which
  // personal-group members hold any user_role under the selected club.
  // RLS already allows visibility to club co-members.
  const { data: clubScopeFilterData } = useQuery({
    queryKey: [
      "messages-club-scope-filter",
      user?.id,
      effectiveClubFilter,
      personalGroupIds.join(","),
      dmOtherUserIds.join(","),
    ],
    enabled: !!user && !!effectiveClubFilter && (personalGroupIds.length > 0 || dmOtherUserIds.length > 0) && !useIcpLab,
    staleTime: 60_000,
    queryFn: () => fetchInboxClubScopeFilter({
      userId: user!.id,
      clubId: effectiveClubFilter!,
      personalGroupIds,
      dmOtherUserIds,
      client: supabase,
    }),
  });

  const clubScopedUsersInClub = clubScopeFilterData?.usersInClub;
  const clubScopedGroupMembers = clubScopeFilterData?.groupMembersMap;



  const filteredLeagueChats = useMemo(
    () => filterInboxLeagueChats({
      groups: leagueChats,
      query,
      clubId: effectiveClubFilter,
    }) as typeof leagueChats,
    [leagueChats, query, effectiveClubFilter],
  );

  const filteredChatGroups = useMemo(
    () => filterInboxChatGroups({
      groups: regularChatGroups,
      query,
      effectiveClubId: effectiveClubFilter,
      activeClubId: activeClubFilter,
      activeClubTeamIds,
      displayedTeams: displayTeams,
      competitionClubMap,
      groupMembersMap: clubScopedGroupMembers,
      usersInClub: clubScopedUsersInClub,
      currentUserId: user?.id,
      hiddenGroupMap,
      latestGroupMessages: displayLatestGroupMessages,
    }) as typeof regularChatGroups,
    [regularChatGroups, query, effectiveClubFilter, activeClubFilter, activeClubTeamIds, displayTeams, hiddenGroupMap, displayLatestGroupMessages, competitionClubMap, clubScopedGroupMembers, clubScopedUsersInClub, user?.id],
  );

  const filteredTeams = useMemo(
    () => filterInboxTeams({
      teams: displayTeams,
      query,
      effectiveClubId: effectiveClubFilter,
      activeClubId: activeClubFilter,
      activeClubTeamIds,
    }) as typeof displayTeams,
    [displayTeams, query, effectiveClubFilter, activeClubFilter, activeClubTeamIds],
  );

  const filteredClubs = useMemo(
    () => filterInboxClubs({
      clubs: displayClubsWithAnnouncements,
      query,
      clubId: effectiveClubFilter,
    }),
    [displayClubsWithAnnouncements, query, effectiveClubFilter],
  );

  const showBroadcast = !query || "announcements".includes(query);

  // Live drafts (unsent text in any chat composer)
  const allDrafts = useAllChatDrafts();

  // Offline fallback: when the DM query errors (no network), React Query drops
  // the placeholder and `dmConversations` is undefined. Rebuild the list from
  // the user-scoped cache so saved conversations stay selectable offline.
  const offlineCachedDMs = useMemo(() => {
    if (!cachedData?.dmConversations?.length) return [];
    return cachedData.dmConversations.map((conv: any) => ({
      ...conv,
      created_at: conv.created_at || conv.updated_at,
      created_by: conv.created_by || null,
      last_message: cachedData.latestDMMessages?.[conv.id]
        ? {
            text: cachedData.latestDMMessages[conv.id].text,
            image_url: cachedData.latestDMMessages[conv.id].image_url || null,
            created_at: cachedData.latestDMMessages[conv.id].created_at,
            author_id:
              cachedData.latestDMMessages[conv.id].author === "You"
                ? user?.id || ""
                : conv.other_user?.id || "",
          }
        : null,
    })) as any[];
  }, [cachedData, user?.id]);

  // Resume stability: keep the last non-empty DM list while the query is
  // refetching/errored so rows do not blink out of the inbox.
  const stickyDMConversations = useStickyList<any>(dmConversations as any[] | undefined, {
    isFetching: dmFetching,
    isFetched: dmFetched,
    isError: dmError,
    resetKey: user?.id ?? null,
  });

  const effectiveDMConversations = useMemo(() => {
    if (stickyDMConversations?.length) return stickyDMConversations as any[];
    if (!isOnline && offlineCachedDMs.length) return offlineCachedDMs;
    return (stickyDMConversations as any[]) ?? [];
  }, [stickyDMConversations, isOnline, offlineCachedDMs]);

  // Filtered DM conversations
  // Hide empty DMs (no messages exchanged) from the list — these are stub
  // conversation rows that get created when someone opens a DM thread without
  // sending anything. They'd otherwise float to the top via `updated_at`.
  const filteredDMs = useMemo(() => {
    if (!effectiveDMConversations.length) return [];
    // Fail CLOSED while the club-scope lookup for the *current* club filter is
    // still resolving. Otherwise, immediately after switching clubs, the DM
    // rows of the previous club render for a beat before the scope data lands
    // and filters them out. (`clubScopeFilterData` is keyed by the filter, so
    // undefined here means "not yet known for this club".)
    if (effectiveClubFilter && !clubScopeFilterData && dmOtherUserIds.length > 0 && isOnline) {
      return [];
    }
    return filterInboxDirectMessages({
      conversations: effectiveDMConversations,
      query,
      drafts: allDrafts,
      hiddenMap: hiddenDMMap,
      effectiveClubId: effectiveClubFilter,
      usersInClub: clubScopedUsersInClub,
      // Preserve the page's previous club-scope behavior for all DM peers.
      isSupportUser: () => false,
    });
  }, [effectiveDMConversations, hiddenDMMap, query, allDrafts, effectiveClubFilter, clubScopedUsersInClub, clubScopeFilterData, dmOtherUserIds.length, isOnline]);




  // Check if Ignite Support should show
  const showIgniteSupport = systemMessage && (!query || "ignite support".includes(query));

  const freshUnifiedConversations = useMemo(() => buildUnifiedInboxConversations({
    showBroadcast,
    latestBroadcast: displayLatestBroadcast,
    clubs: filteredClubs,
    teams: filteredTeams,
    leagueChats: filteredLeagueChats as Parameters<typeof buildUnifiedInboxConversations>[0]["leagueChats"],
    chatGroups: filteredChatGroups as Parameters<typeof buildUnifiedInboxConversations>[0]["chatGroups"],
    directMessages: filteredDMs,
    adminConversations: clubAdminConversations,
    latestClubMessages: displayLatestClubMessages,
    latestTeamMessages: displayLatestTeamMessages,
    latestGroupMessages: displayLatestGroupMessages,
    unreadCounts,
    realtimeGroupUnread: groupUnreadCache,
    muted: mutedChats,
    clubProStatuses: clubProStatus,
    isClubProLoading: isLoadingClubProStatus,
    isClubProFetching: isFetchingClubProStatus,
    isAppAdmin,
    query,
    currentUserId: user?.id,
    showSupport: !!showIgniteSupport,
    systemMessage,
    drafts: allDrafts,
    isSupportUser: isIgniteSupportUser,
  }), [
    showBroadcast, displayLatestBroadcast, unreadCounts, groupUnreadCache,
    filteredClubs, displayLatestClubMessages, isLoadingClubProStatus, isFetchingClubProStatus, clubProStatus, mutedChats,
    filteredTeams, displayLatestTeamMessages,
    filteredLeagueChats, filteredChatGroups, displayLatestGroupMessages,
    filteredDMs, clubAdminConversations, query, user?.id, showIgniteSupport, systemMessage, allDrafts,
  ]);

  // Keep the final authorised read model coherent across native resume and
  // background refetches. Individual sticky source arrays are insufficient:
  // a derived role/filter input can settle one render before another source
  // and temporarily remove an otherwise retained row. Only publish the fresh
  // model once the complete ordering/source set is settled; a settled empty
  // model remains authoritative, so real deletions and permission removals
  // are never retained indefinitely.
  const unifiedConversations = useStableInboxReadModel(freshUnifiedConversations, {
    authoritative: !isOnline || (
      sortSourcesSettled &&
      !isAppAdminFetching &&
      !isCommitteeMemberFetching &&
      !userAllRolesFetching &&
      !userLeagueIdsFetching
    ),
    resetKey: user?.id
      ? `${user.id}:${effectiveClubFilter ?? "all"}:${query}`
      : null,
  });

  useInboxOpenLatency({
    userId: user?.id,
    hasCachedData: !!cachedData,
    hasRows: unifiedConversations.length > 0,
    sourceQueriesFetched: teamsFetched && memberClubsFetched && chatGroupsFetched && dmFetched && latestBroadcastFetched,
    inboxOpenStartTs: inboxOpenStartRef.current,
    inboxMountTs: inboxMountTsRef.current,
    inboxBootstrapReturnTs: inboxBootstrapReturnTsRef.current,
    inboxFirstPaintTsRef,
    primaryClubId: (memberClubs?.[0] as any)?.id ?? null,
    sectionCounts: {
      teams: filteredTeams.length,
      clubs: filteredClubs.length,
      groups: filteredChatGroups.length + filteredLeagueChats.length,
      dms: filteredDMs.length,
      total: unifiedConversations.length,
    },
  });

  const { eventTitleMap, vaultFolderNameMap, vaultFileNameMap } =
    useInboxPreviewReferenceNames(unifiedConversations, supabase);

  // Broadcasts and Ignite Support keep their special visibility semantics in the shared read-model helper.
  const typeFilteredConversations = useMemo(
    () => filterInboxConversations(unifiedConversations, typeFilter),
    [unifiedConversations, typeFilter],
  );

  const { unread: unreadItems, recent: recentItems } = useMemo(
    () => partitionInboxByReadState(typeFilteredConversations),
    [typeFilteredConversations],
  );

  const { visibleRecent, hiddenOps } = useMemo(
    () => resolveOperationalConversationDisclosure(recentItems, {
      now: Date.now(),
      showAll: showAllOps,
      typeFilter,
      hasSearchQuery: !!query,
    }),
    [recentItems, showAllOps, typeFilter, query],
  );


  const hasNoResults = query && unifiedConversations.length === 0;
  const hasNoMessages = !displayTeams?.length && !displayMemberClubs?.length && displayChatGroups.length === 0 && filteredDMs.length === 0;

  // If a specific club is in scope (active club theme or local filter), use that
  // club's Pro status — otherwise fall back to the global "any Pro" check. This
  // prevents the upgrade banner from showing for admins of a Pro club just
  // because they also belong to a Free club elsewhere.
  // Treat Pro access as unknown until both queries have actually returned data.
  // The clubProStatus query is `enabled` only after memberClubIds resolves, so
  // its loading flags can briefly be false-without-data on first render after
  // login (especially noticeable on iOS WebView resume) — without this guard
  // the upgrade banner flashes for admins of a Pro club. Mirrors the lock
  // logic at line ~1394.
  const proAccessQueryReady = !isLoadingProAccess && !isFetchingProAccess && hasAnyProAccess !== undefined;
  const clubProQueryReady = !isLoadingClubProStatus && !isFetchingClubProStatus && clubProStatus !== undefined;
  const scopedClubIsPro = effectiveClubFilter ? clubProStatus?.[effectiveClubFilter] === true : null;
  const proGateFails = effectiveClubFilter
    ? clubProQueryReady && scopedClubIsPro === false
    : proAccessQueryReady && hasAnyProAccess === false;
  const hasAdminRoleButNoPro = proAccessQueryReady && clubProQueryReady && !!(adminTeamIds?.length || adminClubs?.length) && proGateFails && isAppAdmin === false;
  const scopedAdminClubId = effectiveClubFilter
    ? displayAdminClubs.find((club: any) => club.id === effectiveClubFilter)?.id ?? null
    : null;
  const upgradeClubId = effectiveClubFilter
    ? scopedAdminClubId ?? effectiveClubFilter
    : displayAdminClubs[0]?.id ?? displayMemberClubs[0]?.id ?? null;

  // Type label map
  const typeLabels: Record<string, string> = {
    club: 'Club',
    team: 'Team',
    group: 'Group',
    admin_group: 'Admin',
    league: 'League',
    dm: 'DM',
  };

  // Stable hide-callbacks so memoized rows don't invalidate on parent re-renders.
  const hideDMRef = useRef(hideDMMutation);
  hideDMRef.current = hideDMMutation;
  const hideGroupRef = useRef(hideGroupMutation);
  hideGroupRef.current = hideGroupMutation;
  const onHideDM = useMemo(() => (id: string) => hideDMRef.current.mutate(id), []);
  const onHideGroup = useMemo(() => (id: string) => hideGroupRef.current.mutate(id), []);

  // Render a unified conversation card — thin wrapper around the memoized
  // ConversationRow component. Keeping the function preserves all existing
  // call sites; the actual render path is memoized per-item so unrelated
  // inbox refreshes (polling, realtime ticks) no longer re-render every row.
  const renderConversationCard = (item: UnifiedConversation) => {
    const typeLabel = typeLabels[item.type];
    return (
      <ConversationRow
        key={item.key}
        item={item}
        currentUserId={user?.id}
        typeLabel={typeLabel}
        accentStyle={conversationTypeAccentStyle(item.type)}
        badgeStyle={conversationTypeBadgeStyle(item.type)}
        eventTitleMap={eventTitleMap}
        vaultFolderNameMap={vaultFolderNameMap}
        vaultFileNameMap={vaultFileNameMap}
        onHideDM={onHideDM}
        onHideGroup={onHideGroup}
      />
    );
  };

  return (
    <div className="py-4 space-y-4">

      {!isOnline && (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>You're offline — showing saved conversations.</span>
        </div>
      )}

      <MessagesPageHeader
        isLoadingFreshData={isLoadingFreshData}
        hasCachedData={hasCachedData}
        activeClubFilter={activeClubFilter}
        displayMemberClubCount={displayMemberClubs.length}
        hasLocalFilter={hasLocalFilter}
        canShowRecap={aiCatchUpResolved && recapVisible}
        hasAdminRoleButNoPro={hasAdminRoleButNoPro}
        upgradeClubId={upgradeClubId}
        adminTeamIds={adminTeamIds}
        onClearClubFilter={() => setLocalClubFilter("all")}
        onOpenClubFilter={() => setShowClubFilterDrawer(true)}
        onOpenRecap={() => setShowGlobalRecap(true)}
        onNavigateToScheduledMessages={() => navigate("/scheduled-messages")}
        onOpenNewMessage={() => setShowNewMessageSheet(true)}
        onNavigateToUpgrade={navigate}
      />

      <QueryErrorBanner
        // Only alarm the user when there is genuinely nothing to show. A
        // failed background refresh over a rendered (cached) inbox is not an
        // error the user needs to act on.
        hasError={
          !!(teamsError || memberClubsError || chatGroupsError) &&
          unifiedConversations.length === 0
        }
        onRetry={async () => {
          // No `stale` filter: errored queries that still hold cached data are
          // stale, so filtering by `stale: false` made retry a silent no-op.
          await queryClient.refetchQueries({ type: "all", predicate: (q) => q.state.status === "error" });
        }}
        message="Couldn't load chats. Tap to retry."
      />

      <MessagesPageDialogs
        showGlobalRecap={showGlobalRecap}
        recapScopes={unifiedConversations
          .filter((conversation) =>
            conversation.unreadCount > 0
            && !conversation.isLocked
            && (conversation.type === "team"
              || conversation.type === "club"
              || conversation.type === "group"
              || conversation.type === "league"
              || conversation.type === "dm"),
          )
          .map((conversation) => ({
            scope_type: conversation.type === "team"
              ? "team"
              : conversation.type === "club"
                ? "club"
                : conversation.type === "dm"
                  ? "direct"
                  : "group",
            scope_id: conversation.id,
            name: conversation.name,
            link: conversation.link,
            unreadCount: conversation.unreadCount,
            typeLabel: conversation.type,
          }))}
        onShowGlobalRecapChange={setShowGlobalRecap}
        showNewMessageSheet={showNewMessageSheet}
        onShowNewMessageSheetChange={setShowNewMessageSheet}
        canCreateGroups={!!canCreateGroups}
        canCreateCustomGroup={!!(hasAnyProAccess || isAppAdmin)}
        hasPro={effectiveClubFilter ? scopedClubIsPro === true : !!hasAnyProAccess}
        isAppAdmin={!!isAppAdmin}
        upgradeClubId={upgradeClubId}
        onPickDM={() => setShowDMDialog(true)}
        onPickCustomGroup={() => setShowCustomGroupDialog(true)}
        onPickTeamGroup={() => {
          setGroupDialogType("team");
          setShowGroupDialog(true);
        }}
        onPickRoleGroup={() => {
          setGroupDialogType("role");
          setShowGroupDialog(true);
        }}
        showDMDialog={showDMDialog}
        onShowDMDialogChange={setShowDMDialog}
        showCustomGroupDialog={showCustomGroupDialog}
        onShowCustomGroupDialogChange={setShowCustomGroupDialog}
        showGroupDialog={showGroupDialog}
        onShowGroupDialogChange={setShowGroupDialog}
        groupDialogType={groupDialogType}
      />

      <MessagesInboxSections
        model={{
          searchQuery,
          typeFilter,
          isOnline,
          showSkeletonLoading,
          hasLocalFilter,
          localClubFilter,
          showClubFilterDrawer,
          activeClubFilter,
          effectiveClubFilter,
          memberClubs: displayMemberClubs,
          unreadItems,
          recentItems,
          visibleRecent,
          hiddenOps,
          hasNoResults: Boolean(hasNoResults),
          hasNoMessages,
        }}
        actions={{
          setSearchQuery,
          setTypeFilter: (value) => setTypeFilter(value),
          setLocalClubFilter,
          setShowClubFilterDrawer,
          setShowAllOps,
        }}
        renderConversationCard={renderConversationCard}
      />
    </div>
  );
}
