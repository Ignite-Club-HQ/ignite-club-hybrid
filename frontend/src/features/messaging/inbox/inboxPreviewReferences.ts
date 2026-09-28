import {
  extractEventIds,
  extractVaultFileIds,
  extractVaultFolderIds,
} from "@/lib/messagePreview";

export interface InboxPreviewReferenceSource {
  lastMessage?: { text?: string | null } | null;
}

export interface InboxPreviewReferences {
  eventIds: string[];
  vaultFolderIds: string[];
  vaultFileIds: string[];
}

export function collectInboxPreviewReferences(
  conversations: readonly InboxPreviewReferenceSource[],
): InboxPreviewReferences {
  const eventIds = new Set<string>();
  const vaultFolderIds = new Set<string>();
  const vaultFileIds = new Set<string>();

  for (const conversation of conversations) {
    const text = conversation.lastMessage?.text;
    extractEventIds(text).forEach((id) => eventIds.add(id));
    extractVaultFolderIds(text).forEach((id) => vaultFolderIds.add(id));
    extractVaultFileIds(text).forEach((id) => vaultFileIds.add(id));
  }

  return {
    eventIds: Array.from(eventIds),
    vaultFolderIds: Array.from(vaultFolderIds),
    vaultFileIds: Array.from(vaultFileIds),
  };
}
