import { type Dispatch, type SetStateAction } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { removeMessageFromCache } from "@/lib/messageCache";
import type { GroupChatSupabaseClient, GroupMessage } from "@/features/messaging/thread/groupChatData";

interface UseGroupMessageEditDeleteOptions {
  groupId?: string;
  useIcpLab: boolean;
  message: string;
  editingMessage: { id: string } | null;
  setMessage: Dispatch<SetStateAction<string>>;
  setEditingMessage: Dispatch<SetStateAction<{ id: string } | null>>;
  queryClient: QueryClient;
  supabaseClient: GroupChatSupabaseClient;
}

// Update (edit) and hard-delete mutations for a single group message.
// Both are unavailable against the local ICP contract; editing invalidates
// the query so the edited text refetches, while deleting optimistically
// hides the row (with a snapshot rollback on failure) and also prunes the
// local/messages-page caches so the deleted message does not reappear.
export const useGroupMessageEditDelete = ({
  groupId,
  useIcpLab,
  message,
  editingMessage,
  setMessage,
  setEditingMessage,
  queryClient,
  supabaseClient,
}: UseGroupMessageEditDeleteOptions) => {
  const updateMessageMutation = useMutation({
    mutationFn: async () => {
      if (!editingMessage) return;
      if (useIcpLab) {
        throw new Error("Editing group messages is not available in the local ICP contract.");
      }
      const { error } = await supabaseClient
        .from("group_messages")
        .update({ text: message.trim() })
        .eq("id", editingMessage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage("");
      setEditingMessage(null);
      if (useIcpLab) return;
      queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
      // silent success
    },
    onError: () => {
      toast.error("Failed to update message");
    },
  });

  // Delete message mutation (hard delete)
  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (useIcpLab) {
        throw new Error("Deleting group messages is not available in the local ICP contract.");
      }
      const { error } = await supabaseClient
        .from("group_messages")
        .delete()
        .eq("id", messageId);
      if (error) throw error;
    },
    onMutate: async (messageId: string) => {
      // Optimistically hide the message
      await queryClient.cancelQueries({ queryKey: ["group-messages", groupId] });
      const previousData = queryClient.getQueryData(["group-messages", groupId]);

      queryClient.setQueryData(["group-messages", groupId], (old: any) => {
        if (!old) return old;
        const existingMessages: GroupMessage[] = old?.messages || [];
        return { ...old, messages: existingMessages.filter((m) => m.id !== messageId) };
      });

      return { previousData, messageId };
    },
    onSuccess: (_, messageId) => {
      if (useIcpLab) return;

      // Remove from localStorage cache to prevent reappearing
      removeMessageFromCache("group", groupId!, messageId);
      // Clear the messagesPage cache
      try {
        localStorage.removeItem("messages-page-cache");
      } catch {}
      // Invalidate the messages page query so latest message preview updates
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
      // Silent success - no toast
    },
    onError: (err, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(["group-messages", groupId], context.previousData);
      }
      toast.error("Failed to delete message");
    },
  });

  return { updateMessageMutation, deleteMessageMutation };
};
