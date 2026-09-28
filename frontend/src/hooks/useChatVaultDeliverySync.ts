import { useCallback } from "react";
import type { QueuedVaultContext } from "@/lib/messageQueue";

export interface ChatVaultDeliveryContent {
  text: string;
  imageUrl: string | null;
}

interface UseChatVaultDeliverySyncOptions {
  userId: string | null | undefined;
  scope: QueuedVaultContext | null;
  surfaceLabel: string;
}

/**
 * Mirrors content only after the owning send controller has confirmed delivery.
 * The caller retains delivery-state ownership; this hook owns only the common,
 * fire-and-forget Vault side effect and its exact destination scope.
 */
export function useChatVaultDeliverySync({
  userId,
  scope,
  surfaceLabel,
}: UseChatVaultDeliverySyncOptions) {
  return useCallback(
    ({ text, imageUrl }: ChatVaultDeliveryContent) => {
      if (!userId || !scope?.clubId || (!imageUrl && !text)) return;

      import("@/lib/chatVaultSync").then(({ syncChatAttachmentToVault }) => {
        syncChatAttachmentToVault({
          imageUrl,
          text,
          userId,
          clubId: scope.clubId,
          teamId: scope.teamId ?? null,
          chatGroupId: scope.chatGroupId ?? null,
          chatGroupName: scope.chatGroupName ?? null,
          chatGroupAllowedRoles: scope.chatGroupAllowedRoles ?? null,
          isClubAdminChat: scope.isClubAdminChat ?? false,
        }).catch((error) => console.warn(`${surfaceLabel} vault sync failed`, error));
      });
    },
    [scope, surfaceLabel, userId],
  );
}
