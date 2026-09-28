import { useEffect, useCallback, useState, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { 
  Bell,
  CheckCheck, 
  RefreshCw,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { playNotificationSound, showBrowserNotification } from "@/lib/notifications";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { NotificationListCard } from "@/components/notifications/NotificationListCard";
import { resolveTeamInviteRoute } from "@/lib/resolveNotificationRoute";
import { filterClubScopedNotifications } from "@/lib/filterClubScopedNotifications";
import { setPendingChatJump, withChatJumpNonce, type ChatJumpKind } from "@/lib/pendingChatJump";
import { useClubTheme } from "@/hooks/useClubTheme";
import {
  chatTargetPath,
  resolveChatTargetForMessageId,
  resolveChatTargetResult,
  NOTIFICATION_FALLBACK_PATH,
  type ChatTarget,
} from "@/lib/notificationChatRouting";
import { requestClubSwitchForChatTarget, requestClubSwitchForNotificationUrl } from "@/lib/notificationClubSwitch";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import * as fixtureData from "@/lab/fixtureDataLayer";
import {
  invalidateNotificationSurfaces,
  notificationListFamilyKey,
} from "@/lab/notificationCachePolicy";
import { notificationKeys } from "@/lab/notificationQueryKeys";


/**
 * A notification tap whose message lookup FAILED (offline / dropped socket) must
 * not redirect anywhere — the message probably still exists. Keep the user on
 * the list and invite a retry.
 */
function warnUnreachableNotification() {
  toast.error("Couldn't open this message", {
    description: "Your connection looks unstable. Tap it again once you're back online.",
  });
}



/**
 * Belt-and-braces: when navigating from a notification tap to a chat that
 * should scroll to a specific message, also persist the target in
 * sessionStorage. GroupChatPage / TeamChatPage / etc. read this as a fallback
 * when `?message=` is missing (e.g. React Router strips the search param
 * during an auth-gated redirect, or the user is already on the target chat
 * and useSearchParams hasn't re-fired yet).
 */
function jumpAndNavigate(
  navigate: (to: string) => void,
  kind: ChatJumpKind,
  targetId: string | null,
  messageId: string,
  to: string,
) {
  console.log("[InAppNotifTap] jumpAndNavigate", { kind, targetId, messageId, to });
  try { setPendingChatJump(kind, targetId, messageId); } catch { /* ignore */ }
  // A bell tap is a user-driven action, so it MAY move the global active-club
  // filter to the club that owns this thread (same rationale as a push tap).
  // Resolve first (bounded) so the destination doesn't render under the wrong
  // club, then navigate. Membership is verified before the filter actually
  // changes, inside useNotificationClubSwitch.
  void requestClubSwitchForChatTarget(kind, targetId)
    .catch(() => { /* never block navigation */ })
    .finally(() => navigate(withChatJumpNonce(to)));
}


interface Notification {
  id: string;
  user_id: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
  related_id: string | null;
}

type MessageReactionTargetRow = {
  team_message_id?: string | null;
  club_message_id?: string | null;
  group_message_id?: string | null;
  direct_message_id?: string | null;
  broadcast_message_id?: string | null;
  club_admin_message_id?: string | null;
};


const resolveLegacyReactionTarget = async (notification: Notification): Promise<ChatTarget | null> => {
  if (!notification.related_id) return null;
  const at = new Date(notification.created_at).getTime();
  if (!Number.isFinite(at)) return null;
  const from = new Date(at - 5000).toISOString();
  const to = new Date(at + 5000).toISOString();

  const { data: reactions } = await supabase
    .from("message_reactions")
    .select("team_message_id, club_message_id, group_message_id, direct_message_id, broadcast_message_id, club_admin_message_id, created_at")
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: false })
    .limit(30);

  const rows: MessageReactionTargetRow[] = Array.isArray(reactions) ? reactions : [];
  const pick = (key: keyof MessageReactionTargetRow) => rows.map((r) => r[key]).filter((id): id is string => Boolean(id));
  const relatedId = notification.related_id;
  const authorId = notification.user_id;

  const teamIds = pick("team_message_id");
  if (teamIds.length) {
    const { data } = await supabase.from("team_messages").select("id, team_id").in("id", teamIds).eq("team_id", relatedId).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id && msg.team_id) return { kind: "team", targetId: msg.team_id, messageId: msg.id, path: chatTargetPath("team", msg.team_id, msg.id) };
  }

  const clubIds = pick("club_message_id");
  if (clubIds.length) {
    const { data } = await supabase.from("club_messages").select("id, club_id").in("id", clubIds).eq("club_id", relatedId).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id && msg.club_id) return { kind: "club", targetId: msg.club_id, messageId: msg.id, path: chatTargetPath("club", msg.club_id, msg.id) };
  }

  const groupIds = pick("group_message_id");
  if (groupIds.length) {
    const { data } = await supabase.from("group_messages").select("id, group_id").in("id", groupIds).eq("group_id", relatedId).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id && msg.group_id) return { kind: "group", targetId: msg.group_id, messageId: msg.id, path: chatTargetPath("group", msg.group_id, msg.id) };
  }

  const dmIds = pick("direct_message_id");
  if (dmIds.length) {
    const { data } = await supabase.from("direct_messages").select("id, conversation_id").in("id", dmIds).eq("conversation_id", relatedId).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id && msg.conversation_id) return { kind: "dm", targetId: msg.conversation_id, messageId: msg.id, path: chatTargetPath("dm", msg.conversation_id, msg.id) };
  }

  const broadcastIds = pick("broadcast_message_id");
  if (broadcastIds.length) {
    const { data } = await supabase.from("broadcast_messages").select("id").in("id", broadcastIds).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id) return { kind: "broadcast", targetId: null, messageId: msg.id, path: chatTargetPath("broadcast", null, msg.id) };
  }

  const clubAdminIds = pick("club_admin_message_id");
  if (clubAdminIds.length) {
    const { data } = await supabase.from("club_admin_messages").select("id, conversation_id").in("id", clubAdminIds).eq("conversation_id", relatedId).eq("author_id", authorId).limit(1);
    const msg = data?.[0];
    if (msg?.id && msg.conversation_id) return { kind: "club_admin", targetId: msg.conversation_id, messageId: msg.id, path: chatTargetPath("club_admin", msg.conversation_id, msg.id) };
  }

  return null;
};

const navigateToChatTarget = (navigate: (to: string) => void, target: ChatTarget) => {
  jumpAndNavigate(navigate, target.kind, target.targetId, target.messageId, target.path);
};

// Helper component for rendering notification icons with read state
const NOTIFICATIONS_PER_PAGE = 30;

export default function NotificationsPage() {
  const { user, refreshUnreadCount, clearUnreadCount } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const { activeClubFilter, setActiveClubTheme } = useClubTheme();
  usePageTitle("Notifications");
  const navigate = useNavigate();
  const routerNavigate = navigate;

  const queryClient = useQueryClient();
  
  // Sync unread badge on mount
  useEffect(() => {
    refreshUnreadCount();
  }, [refreshUnreadCount]);

  // Pull-to-refresh state
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [displayCount, setDisplayCount] = useState(NOTIFICATIONS_PER_PAGE);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const PULL_THRESHOLD = 80;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setDisplayCount(NOTIFICATIONS_PER_PAGE);
    await queryClient.invalidateQueries({ queryKey: notificationListFamilyKey(user?.id) });
    setTimeout(() => {
      setIsRefreshing(false);
      setPullDistance(0);
    }, 500);
  }, [queryClient, user?.id]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (containerRef.current?.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling || isRefreshing) return;
    
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    
    if (diff > 0 && containerRef.current?.scrollTop === 0) {
      e.preventDefault();
      setPullDistance(Math.min(diff * 0.5, PULL_THRESHOLD * 1.5));
    }
  }, [isPulling, isRefreshing]);

  const handleTouchEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      handleRefresh();
    } else {
      setPullDistance(0);
    }
    setIsPulling(false);
  }, [pullDistance, isRefreshing, handleRefresh]);

  const { data: notifications, isLoading } = useQuery({
    queryKey: notificationKeys.list(user?.id, activeClubFilter),
    queryFn: async () => {
      if (useIcpLab && user?.id) {
        return fixtureData.getLocalLabNotifications(user.id);
      }

      const { data, error } = await supabase
        .from("notifications")
        .select("id, user_id, type, message, related_id, is_read, created_at, club_id")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(500); // Cap at 500 for performance

      if (error) throw error;
      let rows = (data || []) as any[];

      // Scope to the active club using the SAME resolver as the bell dropdown
      // (filterClubScopedNotifications). A raw SQL `club_id.eq` filter would
      // silently drop legacy null-club rows that the bell can still attribute
      // via related_id lookups (e.g. reward_claimed -> reward_redemptions),
      // which made "View all notifications" show fewer items than the
      // dropdown. Filtering here keeps both surfaces consistent.
      if (activeClubFilter) {
        rows = await filterClubScopedNotifications(rows, user!.id, activeClubFilter);
      }
      return rows.map(n => ({ ...n, read: n.is_read })) as Notification[];
    },
    enabled: !!user,
    staleTime: 30000, // Consider data fresh for 30 seconds
    // Must be "always" (not `true`) so opening the page after the bell badge
    // updated elsewhere never renders a stale read/unread split — `true` is a
    // no-op while staleTime is unmet, which made the page disagree with the bell.
    refetchOnMount: "always",
  });

  // Split into unread (newest first) and earlier/read (newest first) BEFORE
  // paginating, so unread rows are never hidden behind the "load more" cut-off
  // (which made the bell show unread while the page showed only "Earlier").
  const allUnread = notifications?.filter((n) => !n.read) || [];
  const allEarlier = notifications?.filter((n) => n.read) || [];
  const unreadNotifications = allUnread;
  const earlierNotifications = allEarlier.slice(0, Math.max(0, displayCount - allUnread.length));
  const displayedNotifications = [...unreadNotifications, ...earlierNotifications];

  // Cross-club unread nudge: unread notifications that belong to a DIFFERENT
  // club than the active filter are invisible here by design. Surface a single
  // subtle row so multi-club users know they exist. Skipped when viewing
  // "All clubs" (nothing is hidden then).
  const { data: otherClubUnread } = useQuery({
    queryKey: ["notifications-other-clubs-unread", user?.id, activeClubFilter],
    enabled: !!user?.id && !!activeClubFilter && !useIcpLab,
    staleTime: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("club_id")
        .eq("user_id", user!.id)
        .eq("is_read", false)
        .not("club_id", "is", null)
        .neq("club_id", activeClubFilter!)
        .limit(500);
      if (error) throw error;

      const rows = data || [];
      const clubIds = [...new Set(rows.map((r: any) => r.club_id).filter(Boolean))] as string[];
      let singleClubName: string | null = null;
      if (clubIds.length === 1) {
        const { data: club } = await supabase
          .from("clubs")
          .select("name")
          .eq("id", clubIds[0])
          .maybeSingle();
        singleClubName = (club as any)?.name?.trim() || null;
      }
      return { count: rows.length, singleClubName };
    },
  });
  const hasMore = (notifications?.length || 0) > displayCount;

  const loadMore = useCallback(() => {
    setDisplayCount(prev => prev + NOTIFICATIONS_PER_PAGE);
  }, []);

  // Real-time subscription for new notifications - direct cache updates
  useEffect(() => {
    if (!user || useIcpLab) return;

    // Channel name is scoped to the user id AND to this page. `useAuth` runs
    // its own global `notifications-realtime` subscription for unread-count
    // updates; if this page reused the same channel name, supabase-js would
    // return the already-subscribed channel from its registry and adding
    // `.on('postgres_changes', ...)` here would throw
    // "cannot add postgres_changes callbacks after subscribe()".
    const channel = supabase
      .channel(`notifications-page-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const raw = payload.new as any;
          const newNotification: Notification = { ...raw, read: raw.is_read };
          queryClient.setQueriesData<Notification[]>(
            { queryKey: notificationListFamilyKey(user.id) },
            (old) => old ? [newNotification, ...old] : [newNotification]
          );
          
          refreshUnreadCount();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const raw = payload.new as any;
          const updated: Notification = { ...raw, read: raw.is_read };
          queryClient.setQueriesData<Notification[]>(
            { queryKey: notificationListFamilyKey(user.id) },
            (old) => old?.map(n => n.id === updated.id ? updated : n) || []
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const deleted = payload.old as { id: string };
          queryClient.setQueriesData<Notification[]>(
            { queryKey: notificationListFamilyKey(user.id) },
            (old) => old?.filter(n => n.id !== deleted.id) || []
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient, refreshUnreadCount, useIcpLab]);

  const markAsRead = useMutation({
    mutationFn: async (id: string) => {
      if (useIcpLab) return id;

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      // Optimistic update
      queryClient.setQueriesData<Notification[]>(
        { queryKey: notificationKeys.list(user?.id, activeClubFilter) },
        (old) => old?.map(n => n.id === id ? { ...n, read: true } : n) || []
      );
    },
    onSuccess: () => {
      refreshUnreadCount();
    },
  });

  // Mark-all / clear-all operate on the currently VISIBLE (club-filtered)
  // notifications by id, so legacy null-club rows attributed to this club by
  // the resolver are included exactly as shown on screen.
  const markAllAsRead = useMutation({
    mutationFn: async () => {
      const ids = (notifications || []).filter((n) => !n.read).map((n) => n.id);
      if (ids.length === 0) return;
      if (useIcpLab) return;

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", ids);
      if (error) throw error;
    },
    onMutate: async () => {
      // Optimistic update - mark visible notifications as read
      queryClient.setQueriesData<Notification[]>(
        { queryKey: notificationKeys.list(user?.id, activeClubFilter) },
        (old) => old?.map(n => ({ ...n, read: true })) || []
      );
    },
    onSuccess: () => {
      if (!activeClubFilter) clearUnreadCount();
      invalidateNotificationSurfaces(queryClient, { includeMessageUnread: true });
      setTimeout(() => refreshUnreadCount(), 300);
    },
  });


  const deleteNotification = useMutation({
    mutationFn: async (id: string) => {
      if (useIcpLab) return id;

      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      // Optimistic update - remove from list
      queryClient.setQueriesData<Notification[]>(
        { queryKey: notificationKeys.list(user?.id, activeClubFilter) },
        (old) => old?.filter(n => n.id !== id) || []
      );
    },
    onSuccess: () => {
      refreshUnreadCount();
    },
  });

  const clearAllNotifications = useMutation({
    mutationFn: async () => {
      const ids = (notifications || []).map((n) => n.id);
      if (ids.length === 0) return;
      if (useIcpLab) return;

      const { error } = await supabase
        .from("notifications")
        .delete()
        .in("id", ids);
      if (error) throw error;
    },
    onMutate: async () => {
      // Cancel any in-flight queries to prevent stale data overwriting
      await queryClient.cancelQueries({ queryKey: notificationListFamilyKey(user?.id) });
      await queryClient.cancelQueries({ queryKey: notificationKeys.recent });
      await queryClient.cancelQueries({ queryKey: notificationKeys.globalUnread });
      // Optimistic update - clear visible notifications
      queryClient.setQueriesData<Notification[]>({ queryKey: notificationKeys.list(user?.id, activeClubFilter) }, []);
    },
    onSuccess: () => {
      if (!activeClubFilter) clearUnreadCount();
      setDisplayCount(NOTIFICATIONS_PER_PAGE);
      // Invalidate all notification-related queries for consistency
      invalidateNotificationSurfaces(queryClient, { includeMessageUnread: true });
      // Force refresh to get accurate count from server
      setTimeout(() => refreshUnreadCount(), 300);
    },
  });


  type AppRole = Database["public"]["Enums"]["app_role"];

  // Translate raw RPC / network errors into a friendly, actionable toast message.
  const friendlyRequestError = (error: unknown, action: "approve" | "deny"): string => {
    const e = error as { message?: string; details?: string; hint?: string; code?: string } | null;
    const raw = [e?.message, e?.details, e?.hint, e?.code, String(error ?? "")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const verb = action === "approve" ? "approve" : "deny";

    if (raw.includes("not authorized") || raw.includes("permission denied")) {
      return `You don't have permission to ${verb} this request. Only team admins, coaches, and club admins can manage join requests.`;
    }
    if (
      raw.includes("already processed") ||
      raw.includes("already approved") ||
      raw.includes("already denied") ||
      raw.includes("already handled") ||
      raw.includes("not pending")
    ) {
      const past = action === "approve" ? "approved" : "denied";
      return `This request has already been ${past} — likely by another admin. Pull to refresh to see the latest list.`;
    }
    if (raw.includes("request not found") || raw.includes("not found")) {
      return "This request no longer exists — it may have been withdrawn or already actioned.";
    }
    if (raw.includes("network") || raw.includes("failed to fetch") || raw.includes("timeout")) {
      return `We couldn't reach the server. Check your connection and try ${verb}ing again.`;
    }
    return `Couldn't ${verb} this request right now. Please try again in a moment — if it keeps failing, contact support.`;
  };

  const approveRequest = useMutation({
    mutationFn: async (requestId: string) => {
      // Get the request details for email sending
      const { data: request, error: fetchError } = await supabase
        .from("role_requests")
        .select(`
          *,
          teams:team_id(id, name, club_id, clubs:club_id(id, name, logo_url)),
          clubs:club_id(id, name, logo_url)
        `)
        .eq("id", requestId)
        .maybeSingle();

      if (fetchError || !request) {
        throw new Error("Request not found");
      }

      // Use the secure RPC to approve (handles role insert, notifications, child linking)
      const { error } = await supabase.rpc("approve_role_request", { p_request_id: requestId });
      if (error) throw error;

      // ── Side-effects below: best-effort only. Failures here MUST NOT surface as
      // a "Failed to approve" toast because the approval itself already succeeded.
      try {
        const teamData = request.teams as { id: string; name: string; club_id: string; clubs: { id: string; name: string; logo_url: string | null } | null } | null;
        const clubData = request.clubs as { id: string; name: string; logo_url: string | null } | null;
        const teamName = teamData?.name;
        const clubName = teamData?.clubs?.name || clubData?.name || "the club";
        const clubLogoUrl = teamData?.clubs?.logo_url || clubData?.logo_url;
        const entityName = teamName || clubName;
        const roleName = request.role.replace("_", " ");

        const { data: requesterProfile } = await selectCachedProfileById(request.user_id);

        const { data: emailData } = await supabase.rpc("get_user_emails_by_ids", { user_ids: [request.user_id] });
        const userEmail = emailData?.[0]?.email;

        if (userEmail) {
          const teamLink = request.team_id
            ? `/teams/${request.team_id}`
            : `/clubs/${request.club_id}`;

          await supabase.functions.invoke("send-email", {
            body: {
              to: userEmail,
              subject: `Welcome to ${entityName}! 🎉`,
              template: "join-request-response",
              templateData: {
                recipientName: requesterProfile?.display_name || "Member",
                teamName: teamName,
                clubName: clubName,
                roleName: roleName,
                approved: true,
                teamLink: teamLink,
                clubLogoUrl: clubLogoUrl,
              },
            },
          });
        }
      } catch (sideEffectError) {
        // Approval succeeded; only the welcome email pipeline failed.
        console.warn("[approveRequest] Welcome email side-effect failed:", sideEffectError);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.lists });
      toast.success("Request approved");
    },
    onError: (error: Error) => {
      toast.error(friendlyRequestError(error, "approve"));
    },
  });

  const denyRequest = useMutation({
    mutationFn: async (requestId: string) => {
      // Get request details for email
      const { data: request, error: fetchError } = await supabase
        .from("role_requests")
        .select(`
          *,
          teams:team_id(id, name, club_id, clubs:club_id(id, name, logo_url)),
          clubs:club_id(id, name, logo_url)
        `)
        .eq("id", requestId)
        .maybeSingle();

      if (fetchError || !request) {
        throw new Error("Request not found");
      }

      // Use the secure RPC to deny
      const { error } = await supabase.rpc("deny_role_request", { p_request_id: requestId });
      if (error) throw error;

      // Best-effort email — never let a failure here masquerade as "Failed to deny".
      try {
        const teamData = request.teams as { id: string; name: string; club_id: string; clubs: { id: string; name: string; logo_url: string | null } | null } | null;
        const clubData = request.clubs as { id: string; name: string; logo_url: string | null } | null;
        const teamName = teamData?.name;
        const clubName = teamData?.clubs?.name || clubData?.name || "the club";
        const clubLogoUrl = teamData?.clubs?.logo_url || clubData?.logo_url;
        const entityName = teamName || clubName;
        const roleName = request.role.replace("_", " ");

        const { data: requesterProfile } = await selectCachedProfileById(request.user_id);

        const { data: emailData } = await supabase.rpc("get_user_emails_by_ids", { user_ids: [request.user_id] });
        const userEmail = emailData?.[0]?.email;

        if (userEmail) {
          await supabase.functions.invoke("send-email", {
            body: {
              to: userEmail,
              subject: `Update on your request to join ${entityName}`,
              template: "join-request-response",
              templateData: {
                recipientName: requesterProfile?.display_name || "Member",
                teamName: teamName,
                clubName: clubName,
                roleName: roleName,
                approved: false,
                clubLogoUrl: clubLogoUrl,
              },
            },
          });
        }
      } catch (sideEffectError) {
        console.warn("[denyRequest] Notification email side-effect failed:", sideEffectError);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.lists });
      toast.success("Request denied");
    },
    onError: (error: Error) => {
      toast.error(friendlyRequestError(error, "deny"));
    },
  });

  const openDirectMessageNotification = async (relatedId: string, createdAt?: string | null) => {
    const { data: directMsg } = await supabase
      .from("direct_messages")
      .select("id, conversation_id")
      .eq("id", relatedId)
      .maybeSingle();
    if (directMsg?.conversation_id) {
      jumpAndNavigate(navigate, "dm", directMsg.conversation_id, directMsg.id, `/messages/dm/${directMsg.conversation_id}?message=${directMsg.id}`);
      return true;
    }

    const { data: conversation } = await supabase
      .from("direct_conversations")
      .select("id")
      .eq("id", relatedId)
      .maybeSingle();
    if (!conversation) return false;

    const clickedAt = createdAt ? new Date(createdAt) : null;
    const upperBound = clickedAt && !Number.isNaN(clickedAt.getTime())
      ? new Date(clickedAt.getTime() + 30_000).toISOString()
      : null;
    let messageQuery = supabase
      .from("direct_messages")
      .select("id, conversation_id")
      .eq("conversation_id", relatedId)
      .is("deleted_at", null);
    if (user?.id) messageQuery = messageQuery.neq("author_id", user.id);
    if (upperBound) messageQuery = messageQuery.lte("created_at", upperBound);
    const { data: nearestMsg } = await messageQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (nearestMsg?.id) {
      jumpAndNavigate(navigate, "dm", relatedId, nearestMsg.id, `/messages/dm/${relatedId}?message=${nearestMsg.id}`);
    } else {
      navigate(`/messages/dm/${relatedId}`);
    }
    return true;
  };

  const handleNotificationClick = async (notification: Notification) => {
    // Every non-chat branch below navigates straight into club-owned content
    // (`/events/:id`, `/media?photo=…`, `/teams/:id`, `/clubs/:id`, …). Route
    // those through a club-scope-aware navigate: a bell tap is user-driven, so
    // it MAY move the active club filter to the club that owns the tapped item.
    // Without this the app stayed filtered to the previous club and
    // `useClubScopeGuard` bounced the user straight back home.
    const navigate = (to: string) => {
      void requestClubSwitchForNotificationUrl(null, to)
        .catch(() => { /* never block navigation */ })
        .finally(() => routerNavigate(to));
    };

    // Mark as read first
    if (!notification.read) {
      markAsRead.mutate(notification.id);
    }

    // Navigate based on notification type
    const relatedId = notification.related_id;
    if (!relatedId) return;


    switch (notification.type) {
      case "message_reaction": {
        // Current notifications store the reacted message id. Some older rows
        // stored only the chat/container id, so recover the exact message from
        // the reaction row created at the same instant.
        const reactionResult = await resolveChatTargetResult(relatedId);
        if (reactionResult.status === "found") { navigateToChatTarget(navigate, reactionResult.target); break; }
        if (reactionResult.status === "unreachable") { warnUnreachableNotification(); break; }
        const legacyReactionTarget = await resolveLegacyReactionTarget(notification);
        if (legacyReactionTarget) { navigateToChatTarget(navigate, legacyReactionTarget); break; }
        // Backward-compat: old notifications stored container id as related_id.
        const { data: teamCheck } = await supabase.from("teams").select("id").eq("id", relatedId).maybeSingle();
        if (teamCheck) { navigate(`/messages/${relatedId}`); break; }
        const { data: clubCheck } = await supabase.from("clubs").select("id").eq("id", relatedId).maybeSingle();
        if (clubCheck) { navigate(`/messages/club/${relatedId}`); break; }
        const { data: groupCheck } = await supabase.from("chat_groups").select("id").eq("id", relatedId).maybeSingle();
        if (groupCheck) { navigate(`/groups/${relatedId}`); break; }
        const { data: convCheck } = await supabase.from("direct_conversations").select("id").eq("id", relatedId).maybeSingle();
        if (convCheck) { navigate(`/messages/dm/${relatedId}`); break; }
        navigate("/messages");
        break;
      }
      case "team_message":
      case "message_reply":
      case "message_mention":
      case "message_forwarded": {
        // related_id is a message id. resolveChatTargetResult probes all six
        // message tables under RLS and distinguishes three outcomes:
        //  - found       → jump to the chat
        //  - not_found   → deleted / no access; safe /messages fallback
        //  - unreachable → a probe FAILED (offline, dropped socket). Stay put
        //                  and tell the user to retry rather than silently
        //                  dumping them on /messages as if the message were gone.
        const result = await resolveChatTargetResult(relatedId);
        if (result.status === "found") {
          navigateToChatTarget(navigate, result.target);
        } else if (result.status === "unreachable") {
          warnUnreachableNotification();
        } else {
          navigate(NOTIFICATION_FALLBACK_PATH);
        }
        break;
      }


      case "club_message":
        const { data: clubMessage } = await supabase
          .from("club_messages")
          .select("club_id")
          .eq("id", relatedId)
          .single();
        if (clubMessage?.club_id) {
          jumpAndNavigate(navigate, "club", clubMessage.club_id, relatedId, `/messages/club/${clubMessage.club_id}?message=${relatedId}`);
        }
        break;
      case "group_message":
        const { data: groupMessage } = await supabase
          .from("group_messages")
          .select("group_id")
          .eq("id", relatedId)
          .single();
        if (groupMessage?.group_id) {
          jumpAndNavigate(navigate, "group", groupMessage.group_id, relatedId, `/groups/${groupMessage.group_id}?message=${relatedId}`);
        }
        break;
      case "club_admin_message": {
        // related_id is the club_admin_messages.id; look up its conversation
        const { data: caMsg } = await (supabase as any)
          .from("club_admin_messages")
          .select("conversation_id")
          .eq("id", relatedId)
          .maybeSingle();
        if (caMsg?.conversation_id) {
          jumpAndNavigate(navigate, "club_admin", caMsg.conversation_id, relatedId, `/messages/club-admin/${caMsg.conversation_id}?message=${relatedId}`);
        } else {
          // Fallback: related_id might already be a conversation id
          const { data: convCheck } = await (supabase as any)
            .from("club_admin_conversations")
            .select("id")
            .eq("id", relatedId)
            .maybeSingle();
          if (convCheck) navigate(`/messages/club-admin/${relatedId}`);
          else navigate("/messages");
        }
        break;
      }
      case "club_news":
        navigate(relatedId ? `/news/${relatedId}` : "/news");
        break;
      case "broadcast":
        jumpAndNavigate(navigate, "broadcast", null, relatedId, `/messages/broadcast?message=${relatedId}`);
        break;
      case "direct_message":
        if (!(await openDirectMessageNotification(relatedId, notification.created_at))) navigate("/messages");
        break;
      case "event_invite":
      case "event_cancelled":
      case "event_updated":
      case "event_reminder":
      case "event_view_reminder":
      case "duty_assigned":
      case "duty_completed":

      case "rsvp":
      case "rsvp_update":
      case "rsvp_updated":
        navigate(`/events/${relatedId}`);
        break;
      case "photo_comment":
      case "photo_reaction": {
        const { data: photoCheck } = await supabase
          .from("photos")
          .select("id, deleted_at")
          .eq("id", relatedId)
          .maybeSingle();
        if (!photoCheck || photoCheck.deleted_at) {
          toast.info("This photo is no longer available.");
          break;
        }
        const suffix = notification.type === "photo_comment" ? "&comments=1" : "";
        navigate(`/media?photo=${relatedId}${suffix}`);
        break;
      }
      case "photo_uploaded": {
        // Land on the gallery filtered to the team/club, not fullscreen.
        const { data: photoCheck } = await supabase
          .from("photos")
          .select("id, team_id, club_id, deleted_at")
          .eq("id", relatedId)
          .maybeSingle();
        if (!photoCheck || photoCheck.deleted_at) {
          navigate("/media");
          break;
        }
        if (photoCheck.team_id) {
          navigate(`/media?team=${photoCheck.team_id}`);
        } else if (photoCheck.club_id) {
          navigate(`/media?club=${photoCheck.club_id}`);
        } else {
          navigate("/media");
        }
        break;
      }
      case "photo_prompt_reminder": {
        // related_id is the event_id — open Media gallery filtered to that team/event
        // with the upload sheet auto-opened.
        const { data: ev } = await supabase
          .from("events")
          .select("id, team_id")
          .eq("id", relatedId)
          .maybeSingle();
        if (ev?.team_id) {
          navigate(`/media?team=${ev.team_id}&event=${ev.id}&upload=1`);
        } else {
          navigate(`/media?upload=1`);
        }
        break;
      }
      case "comment_reaction":
      case "comment_reply": {
        let targetPhotoId: string | null = null;
        if (notification.type === "comment_reply") {
          targetPhotoId = relatedId;
        } else {
          const { data: commentData } = await supabase
            .from("photo_comments")
            .select("photo_id")
            .eq("id", relatedId)
            .maybeSingle();
          targetPhotoId = commentData?.photo_id ?? null;
        }
        if (!targetPhotoId) {
          toast.info("This photo is no longer available.");
          break;
        }
        const { data: photoCheck2 } = await supabase
          .from("photos")
          .select("id, deleted_at")
          .eq("id", targetPhotoId)
          .maybeSingle();
        if (!photoCheck2 || photoCheck2.deleted_at) {
          toast.info("This photo is no longer available.");
          break;
        }
        // comment replies / reactions also belong on the comment screen
        navigate(`/media?photo=${targetPhotoId}&comments=1`);
        break;
      }
      case "team_invite": {
        // related_id may point at team_invites OR pending_invites (parent invites)
        const resolved = await resolveTeamInviteRoute(relatedId);
        if (resolved.kind === "navigate") {
          navigate(resolved.to);
        } else {
          toast.info("This invite is no longer available");
        }
        break;
      }
      case "role_assigned":
      case "invite_accepted":
      case "team_join": {
        // related_id is the team_id — navigate to team page
        if (relatedId) {
          navigate(`/teams/${relatedId}`);
        }
        break;
      }
      case "membership":
      case "role_removed": {
        // related_id is the team_id (team roles) or club_id (club roles).
        // Without this branch the tap fell through to `default` and left the
        // user on /notifications under whichever club was previously active.
        if (relatedId) {
          const { data: teamCheckM } = await supabase
            .from("teams")
            .select("id")
            .eq("id", relatedId)
            .maybeSingle();
          if (teamCheckM) {
            navigate(`/teams/${relatedId}`);
            break;
          }
          const { data: clubCheckM } = await supabase
            .from("clubs")
            .select("id")
            .eq("id", relatedId)
            .maybeSingle();
          if (clubCheckM) {
            navigate(`/clubs/${relatedId}`);
          }
        }
        break;
      }
      case "member_joined": {
        // related_id could be mini_league_id, team_id, or club_id — check which one
        if (relatedId) {
          const { data: miniLeagueCheck } = await supabase
            .from("mini_leagues")
            .select("id")
            .eq("id", relatedId)
            .maybeSingle();
          if (miniLeagueCheck) {
            navigate(`/mini-leagues/${relatedId}`);
          } else {
            const { data: clubCheckMJ } = await supabase
              .from("clubs")
              .select("id")
              .eq("id", relatedId)
              .maybeSingle();
            if (clubCheckMJ) {
              navigate(`/clubs/${relatedId}`);
            } else {
              navigate(`/teams/${relatedId}`);
            }
          }
        }
        break;
      }
      case "club_join": {
        // related_id is the club_id — navigate to club page
        if (relatedId) {
          navigate(`/clubs/${relatedId}`);
        }
        break;
      }
      case "join_request":
        // Just mark as read - admin can approve/deny from notification buttons
        // Don't navigate away since they can take action right here
        break;
      case "join_request_approved":
      case "join_request_denied":
      case "join_request_processed":
        // Navigate to the club or team - relatedId is club_id or team_id
        if (relatedId) {
          // Try to determine if it's a club or team
          const { data: clubCheck } = await supabase
            .from("clubs")
            .select("id")
            .eq("id", relatedId)
            .single();
          if (clubCheck) {
            navigate(`/clubs/${relatedId}`);
          } else {
            navigate(`/teams/${relatedId}`);
          }
        }
        break;
      case "pending_sub":
        // Navigate to home and open the pitch board
        localStorage.setItem('pitch-board-open-source', 'pending_sub');
        navigate("/");
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('open-pitch-board', { detail: { notificationType: 'pending_sub' } }));
        }, 300);
        break;
      case "half_time":
      case "game_finished":
        // related_id is game.id — try to find the linked event from the active game
        if (relatedId) {
          const { data: activeGame } = await supabase
            .from("active_games")
            .select("pitch_state")
            .eq("id", relatedId)
            .maybeSingle();
          const linkedEventId = (activeGame?.pitch_state as any)?.linkedEventId;
          if (linkedEventId) {
            navigate(`/events/${linkedEventId}`);
          } else {
            // Fallback: navigate to home page instead of non-existent /pitch-board
            navigate("/");
          }
        } else {
          navigate("/");
        }
        break;
      case "formation_change":
        // Open the pitch board (same flow as pending_sub).
        // The HomePage listener uses the persisted timer state to know which board to open.
        localStorage.setItem('pitch-board-open-source', 'formation_change');
        navigate("/");
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('open-pitch-board', { detail: { notificationType: 'formation_change' } }));
        }, 300);
        break;
      case "points_awarded":
      case "early_rsvp_points":
      case "reward_redeemed":
      case "player_of_match":
        navigate("/profile?section=points-history");
        break;
      case "leaderboard_update":
      case "streak_progress":
      case "streak_bonus":
      case "reward_proximity":
      case "reward_unlocked":
        navigate("/leaderboard");
        break;
      case "fee_payment_request":
        if (relatedId) {
          navigate(`/pay-fees/${relatedId}`);
        }
        break;
      default:
        break;
    }
  };

  const unreadCount = notifications?.filter((n) => !n.read).length || 0;

  return (
    <div 
      ref={containerRef}
      className="pt-2 pb-6 space-y-4 min-h-full"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div 
        className="flex justify-center items-center overflow-hidden transition-all duration-200"
        style={{ 
          height: pullDistance > 0 ? pullDistance : 0,
          opacity: pullDistance / PULL_THRESHOLD 
        }}
      >
        <RefreshCw 
          className={`h-6 w-6 text-primary transition-transform ${isRefreshing ? 'animate-spin' : ''}`}
          style={{ 
            transform: `rotate(${pullDistance * 2}deg)`,
          }}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">Notifications</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {unreadCount > 0 && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
            >
              <CheckCheck className="h-4 w-4 mr-1" />
              Mark all read
            </Button>
          )}
          {notifications && notifications.length > 0 && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => clearAllNotifications.mutate()}
              disabled={clearAllNotifications.isPending}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear all
            </Button>
          )}
        </div>
      </div>

      {!!activeClubFilter && (otherClubUnread?.count ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => setActiveClubTheme(null)}
          className="mb-3 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-xs text-muted-foreground">
            {otherClubUnread!.count} unread in{" "}
            {otherClubUnread!.singleClubName ?? "other clubs"}
          </span>
          <span className="text-xs font-medium text-primary shrink-0">View all clubs →</span>
        </button>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : notifications?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No notifications yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5" role="list" aria-label={`${displayedNotifications.length} notification${displayedNotifications.length === 1 ? '' : 's'}`}>
          {/* Unread — newest first */}
          {unreadNotifications.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-primary px-1">
                Unread · {unreadNotifications.length}
              </h2>
              {unreadNotifications.map((notification) => (
                <NotificationListCard
                  key={notification.id}
                  notification={notification}
                  variant="unread"
                  onClick={() => handleNotificationClick(notification)}
                  onDelete={() => deleteNotification.mutate(notification.id)}
                  onViewEvent={() => {
                    if (!notification.read) {
                      markAsRead.mutate(notification.id);
                    }
                    navigate(`/events/${notification.related_id}`);
                  }}
                  onMarkAsRead={() => markAsRead.mutate(notification.id)}
                  onApproveJoinRequest={() => approveRequest.mutate(notification.related_id!)}
                  onDenyJoinRequest={() => denyRequest.mutate(notification.related_id!)}
                  joinRequestActionsDisabled={approveRequest.isPending || denyRequest.isPending}
                />
              ))}
            </section>
          )}

          {/* Earlier — read notifications, newest first */}
          {earlierNotifications.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
                Earlier
              </h2>
              {earlierNotifications.map((notification) => (
                <NotificationListCard
                  key={notification.id}
                  notification={notification}
                  variant="earlier"
                  onClick={() => handleNotificationClick(notification)}
                  onDelete={() => deleteNotification.mutate(notification.id)}
                  onViewEvent={() => {
                    if (!notification.read) {
                      markAsRead.mutate(notification.id);
                    }
                    navigate(`/events/${notification.related_id}`);
                  }}
                  onMarkAsRead={() => markAsRead.mutate(notification.id)}
                  onApproveJoinRequest={() => approveRequest.mutate(notification.related_id!)}
                  onDenyJoinRequest={() => denyRequest.mutate(notification.related_id!)}
                  joinRequestActionsDisabled={approveRequest.isPending || denyRequest.isPending}
                />
              ))}
            </section>
          )}
          
          {hasMore && (
            <Button
              variant="outline"
              className="w-full"
              onClick={loadMore}
            >
              Load more ({(notifications?.length || 0) - displayCount} remaining)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
