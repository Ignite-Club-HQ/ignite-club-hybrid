import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";

/** Ordinary users can see only the currently authorized conversation's participants. */
export function useIcpConversationPresence(conversationId: string | null | undefined, options: { enabled?: boolean; shared?: boolean; clubId?: string | null } = {}) {
  const { user, initialized } = useAuth();
  const { data = [] } = useQuery({
    queryKey: ["icp-conversation-presence", user?.id, conversationId, options.clubId, options.shared],
    enabled: !!user && initialized && !!conversationId && options.enabled !== false && isFeatureRoutedToIcp("messaging"),
    queryFn: async () => {
      if (!conversationId) return [];
      const { listLiveConversationOnlineUsers } = await import("@/live/features/messaging");
      return withFeatureBackend("messaging", {
        supabase: async () => [], icp: ctx => listLiveConversationOnlineUsers(ctx, conversationId),
      }, options.shared ? { shared: "person" } : options.clubId ? { clubId: options.clubId } : { conversationId });
    },
    staleTime: 30_000, refetchInterval: 60_000, refetchIntervalInBackground: false,
  });
  return new Set(data);
}