import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Principal } from "@icp-sdk/core/principal";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  liveBlockUser,
  liveListBlockedUsers,
  liveUnblockUser,
} from "@/live/features/messaging";
import { useCallback } from "react";

export function useBlockedUsers() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isIcp = resolveAuthBackend() === "icp";

  const { data: blockedUserIds = [], isLoading } = useQuery({
    queryKey: ["blocked-users", user?.id],
    queryFn: async () => {
      if (isIcp) {
        return withFeatureBackend("messaging", {
          supabase: async () => [] as string[],
          icp: (ctx) => liveListBlockedUsers(ctx),
        });
      }
      const { data, error } = await supabase
        .from("blocked_users")
        .select("blocked_id")
        .eq("blocker_id", user!.id);
      if (error) throw error;
      return data.map((row) => row.blocked_id);
    },
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5,
  });

  const blockUser = useMutation({
    mutationFn: async ({ blockedId, reason }: { blockedId: string; reason?: string }) => {
      if (isIcp) {
        await withFeatureBackend("messaging", {
          supabase: async () => {},
          icp: (ctx) => liveBlockUser(ctx, Principal.fromText(blockedId)),
        });
        return;
      }
      const { error } = await supabase
        .from("blocked_users")
        .insert({ blocker_id: user!.id, blocked_id: blockedId, reason });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocked-users", user?.id] });
    },
  });

  const unblockUser = useMutation({
    mutationFn: async (blockedId: string) => {
      if (isIcp) {
        await withFeatureBackend("messaging", {
          supabase: async () => {},
          icp: (ctx) => liveUnblockUser(ctx, Principal.fromText(blockedId)),
        });
        return;
      }
      const { error } = await supabase
        .from("blocked_users")
        .delete()
        .eq("blocker_id", user!.id)
        .eq("blocked_id", blockedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocked-users", user?.id] });
    },
  });

  const isBlocked = useCallback(
    (userId: string) => blockedUserIds.includes(userId),
    [blockedUserIds]
  );

  return {
    blockedUserIds,
    isLoading,
    blockUser,
    unblockUser,
    isBlocked,
  };
}
