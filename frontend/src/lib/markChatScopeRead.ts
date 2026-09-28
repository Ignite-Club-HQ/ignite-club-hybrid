import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  createEmptyUnreadMessageCounts,
  getTotalUnreadMessageCount,
  type UnreadMessageCounts,
} from "@/lib/unreadMessageCounts";
import { notificationKeys } from "@/lab/notificationQueryKeys";

type Scope =
  | { kind: "team"; teamId: string }
  | { kind: "club"; clubId: string }
  | { kind: "group"; groupId: string }
  | { kind: "dm"; conversationId: string }
  | { kind: "broadcast" };

interface Args {
  userId: string;
  scope: Scope;
  queryClient: QueryClient;
  /** Optimistically decrement the bell badge by this many items. */
  decrementUnreadCount: (n: number) => void;
  /** Safety-net refetch in case the optimistic delta drifts. */
  refreshUnreadCount: () => Promise<void> | void;
}

/**
 * Centralized mark-as-read for chat threads. Does the work in this order so
 * the bell badge and Messages tab unread indicator clear *immediately* when
 * the user opens a thread, instead of waiting 5-10s for the round-trip:
 *
 *   1. Read the current `unread-message-counts` cache and compute how many
 *      unread notifications belong to this scope.
 *   2. Optimistically zero the scope in the cache and decrement the bell
 *      badge by the same amount.
 *   3. Fire the DB UPDATE in the background (no await).
 *   4. Once the UPDATE resolves, invalidate the relevant queries so realtime
 *      drift is corrected.
 */
export function markChatScopeNotificationsRead({
  userId,
  scope,
  queryClient,
  decrementUnreadCount,
  refreshUnreadCount,
}: Args) {
  // 1 + 2: optimistic local update
  const cacheKey = notificationKeys.messageUnreadFor(userId);
  const current =
    queryClient.getQueryData<UnreadMessageCounts>(cacheKey) ??
    createEmptyUnreadMessageCounts();

  let scopeCount = 0;
  const next: UnreadMessageCounts = {
    broadcast: current.broadcast,
    teams: { ...current.teams },
    clubs: { ...current.clubs },
    groups: { ...current.groups },
    dms: { ...current.dms },
  };

  switch (scope.kind) {
    case "broadcast":
      scopeCount = next.broadcast;
      next.broadcast = 0;
      break;
    case "team":
      scopeCount = next.teams[scope.teamId] ?? 0;
      delete next.teams[scope.teamId];
      break;
    case "club":
      scopeCount = next.clubs[scope.clubId] ?? 0;
      delete next.clubs[scope.clubId];
      break;
    case "group":
      scopeCount = next.groups[scope.groupId] ?? 0;
      delete next.groups[scope.groupId];
      break;
    case "dm":
      scopeCount = next.dms[scope.conversationId] ?? 0;
      delete next.dms[scope.conversationId];
      break;
  }

  if (scopeCount > 0) {
    queryClient.setQueryData(cacheKey, next);
    decrementUnreadCount(scopeCount);

    // Optimistically decrement the club-scoped badges too (BottomNav Messages
    // pill + AppHeader bell when a club filter is active). Without this they
    // wait for the realtime UPDATE → invalidate → refetch round-trip, which
    // can take 10-15s on slow networks/mobile.
    queryClient.setQueriesData<number>({ queryKey: notificationKeys.clubMessageUnread }, (old) =>
      typeof old === "number" ? Math.max(0, old - scopeCount) : old
    );
    queryClient.setQueriesData<number>({ queryKey: notificationKeys.clubUnread }, (old) =>
      typeof old === "number" ? Math.max(0, old - scopeCount) : old
    );
  }

  // 3: background DB UPDATE (fire-and-forget — do NOT await)
  void (async () => {
    try {
      // Single RPC handles the primary type + reply/mention/reaction/forward
      // sweep correctly. The previous PostgREST update used
      // .eq("related_id", scope.teamId) which matched ZERO rows because
      // notifications.related_id for team/club/group_message is the *message*
      // id, not the team/club/group id. That meant the badge always snapped
      // back to its prior value after the inbox 30s refetch interval.
      const scopeId =
        scope.kind === "team" ? scope.teamId :
        scope.kind === "club" ? scope.clubId :
        scope.kind === "group" ? scope.groupId :
        scope.kind === "dm" ? scope.conversationId :
        null;

      const { data: affected, error } = await (supabase as any).rpc(
        "mark_chat_scope_notifications_read",
        {
          _user_id: userId,
          _scope_kind: scope.kind,
          _scope_id: scopeId,
        }
      );

      if (error) {
        console.warn("[markChatScopeNotificationsRead] rpc failed", error);
      } else if (typeof affected === "number" && affected > scopeCount) {
        // Server cleared more than our optimistic decrement (reply/mention
        // notifications weren't counted in the per-scope cache). Catch the
        // bell + club badges up so they don't snap upward later.
        const delta = affected - scopeCount;
        decrementUnreadCount(delta);
        queryClient.setQueriesData<number>({ queryKey: notificationKeys.clubMessageUnread }, (old) =>
          typeof old === "number" ? Math.max(0, old - delta) : old
        );
        queryClient.setQueriesData<number>({ queryKey: notificationKeys.clubUnread }, (old) =>
          typeof old === "number" ? Math.max(0, old - delta) : old
        );
      }
    } catch (err) {
      console.warn("[markChatScopeNotificationsRead] rpc threw", err);
    }

    // 4: reconcile (covers any drift if the optimistic count was off, and
    // refreshes the inbox/recent-notifications dropdown).
    try {
      await refreshUnreadCount();
    } catch { }
    queryClient.invalidateQueries({ queryKey: notificationKeys.messageUnreadFor(userId) });
    queryClient.invalidateQueries({ queryKey: notificationKeys.chatGroupUnreadFor(userId) });
    queryClient.invalidateQueries({ queryKey: notificationKeys.recent });
    const post = queryClient.getQueryData<UnreadMessageCounts>(cacheKey);
    if (post) {
      void getTotalUnreadMessageCount(post);
    }
  })();
}
