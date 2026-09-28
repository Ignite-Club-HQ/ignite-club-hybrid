import type { QueryKey } from "@tanstack/react-query";
import { noteChannelRemoved, noteChannelSubscribed } from "@/lib/chatPerfDiagnostics";
import { registerChannel, type RealtimeChannel, type Scope } from "@/lib/realtimeChannelRegistry";
import { supabase } from "@/integrations/supabase/client";

interface ChatRealtimeChannelLifecycleOptions {
  channel: RealtimeChannel;
  channelKey: string;
  userId: string | undefined;
  scope: Scope;
  cacheKeys?: QueryKey[];
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
}: ChatRealtimeChannelLifecycleOptions): () => void {
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
