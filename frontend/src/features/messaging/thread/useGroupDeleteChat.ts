import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { NavigateFunction } from "react-router-dom";
import type { GroupChatSupabaseClient } from "@/features/messaging/thread/groupChatData";

interface UseGroupDeleteChatOptions {
  groupId?: string;
  userId?: string;
  useIcpLab: boolean;
  queryClient: QueryClient;
  supabaseClient: GroupChatSupabaseClient;
  navigate: NavigateFunction;
}

// Soft-deletes the group chat (keeps the row so app admins can restore it
// within the retention window) against Supabase, or drops the local ICP lab
// caches outright since there is no restore workflow for the fixture
// contract. Either path navigates back to the messages list on success.
export const useGroupDeleteChat = ({
  groupId,
  userId,
  useIcpLab,
  queryClient,
  supabaseClient,
  navigate,
}: UseGroupDeleteChatOptions) =>
  useMutation({
    mutationFn: async () => {
      if (useIcpLab) return;

      // Soft-delete: keep the row so app admins can restore within the retention window.
      const { error } = await supabaseClient
        .from("chat_groups")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: userId ?? null,
        } as any)
        .eq("id", groupId!);
      if (error) throw error;
    },
    onSuccess: () => {
      if (useIcpLab) {
        queryClient.removeQueries({ queryKey: ["chat-group", groupId] });
        queryClient.removeQueries({ queryKey: ["group-messages", groupId] });
        toast.success("Local chat removed");
        navigate("/messages");
        return;
      }

      toast.success("Chat removed. An app admin can restore it if needed.");
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
      navigate("/messages");
    },
    onError: () => toast.error("Failed to delete group"),
  });
