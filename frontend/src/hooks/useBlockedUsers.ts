import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCallback } from "react";

export function useBlockedUsers() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: blockedUserIds = [], isLoading } = useQuery({
    queryKey: ["blocked-users", user?.id],
    queryFn: async () => {
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
