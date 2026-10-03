import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { noteChannelRemoved, noteChannelSubscribed } from "@/lib/chatPerfDiagnostics";
import { registerChannel, type RealtimeChannel, type Scope } from "@/lib/realtimeChannelRegistry";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { isChatWsHealthy, subscribeChatPokes } from "@/live/wsRealtime";
import {
  CHAT_POLL_INTERVAL_HIDDEN_MS,
  CHAT_POLL_INTERVAL_VISIBLE_MS,
} from "@/hooks/useClubRealtimeMode";

interface ChatRealtimeChannelLifecycleOptions {
  channel: RealtimeChannel;
  channelKey: string;
  userId: string | undefined;
  scope: Scope;
  cacheKeys?: QueryKey[];
  /** Required for the ICP polling fallback; unused on the realtime path. */
  queryClient?: QueryClient;
}

/**
 * Starts a fully-configured route-specific Realtime channel and applies the
 * subscribe → diagnostics → registry-registration → cleanup lifecycle shared
 * by all six chat routes. Callers build the channel with their own
 * route-specific `.on(...)` handlers before calling this; only the
 * post-configuration lifecycle is identical across routes.
 */
export function startChatRealtimeChannel({
  channel,
  channelKey,
  userId,
  scope,
  cacheKeys,
  queryClient,
}: ChatRealtimeChannelLifecycleOptions): () => void {
  // When messaging is routed to ICP, canisters are request/response — there
  // is no realtime channel to subscribe to. Club/team/group chat screens
  // already poll via useClubRealtimeMode; for the other chat screens, poll
  // the provided cache keys (paused while the tab is hidden) so DMs,
  // broadcast and club-admin chats still refresh on canister backends.
  if (isFeatureRoutedToIcp("messaging")) {
    if (!queryClient || !cacheKeys || cacheKeys.length === 0) return () => {};
    const invalidateAll = () => {
      for (const key of cacheKeys) queryClient.invalidateQueries({ queryKey: key });
    };
    // WebSocket realtime (IC WS gateway): a poke refreshes this screen's keys
    // immediately. While the socket is healthy the poll ticks below become a
    // no-op safety net and resume automatically if the socket drops.
    const unsubscribePokes = subscribeChatPokes(() => invalidateAll());
    const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";
    let scheduledInterval = isVisible() ? CHAT_POLL_INTERVAL_VISIBLE_MS : CHAT_POLL_INTERVAL_HIDDEN_MS;
    let pollId = setInterval(() => {
      if (!isVisible()) return;
      if (isChatWsHealthy()) return;
      invalidateAll();
    }, scheduledInterval);

    const handleVisibilityChange = () => {
      const nextInterval = isVisible() ? CHAT_POLL_INTERVAL_VISIBLE_MS : CHAT_POLL_INTERVAL_HIDDEN_MS;
      if (isVisible()) {
        // Immediate catch-up refetch on visibility regain.
        invalidateAll();
      }
      if (nextInterval !== scheduledInterval) {
        scheduledInterval = nextInterval;
        clearInterval(pollId);
        pollId = setInterval(() => {
          if (!isVisible()) return;
          if (isChatWsHealthy()) return;
          invalidateAll();
        }, scheduledInterval);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      unsubscribePokes();
      clearInterval(pollId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }
  channel.subscribe();
  noteChannelSubscribed(channelKey);

  const unregister = userId
    ? registerChannel({
        key: channelKey,
        channel,
        userId,
        scope,
        cacheKeys,
      })
    : null;

  return () => {
    if (unregister) {
      unregister();
    } else {
      void supabase.removeChannel(channel);
    }
    noteChannelRemoved(channelKey);
  };
}
