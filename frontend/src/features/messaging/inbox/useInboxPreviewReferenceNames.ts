import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { collectInboxPreviewReferences, type InboxPreviewReferenceSource } from "./inboxPreviewReferences";
import {
  fetchInboxEventTitleMap,
  fetchInboxVaultFileNameMap,
  fetchInboxVaultFolderNameMap,
} from "./inboxRepositories";

type InboxDataClient = NonNullable<Parameters<typeof fetchInboxEventTitleMap>[1]>;

export function useInboxPreviewReferenceNames(
  conversations: readonly InboxPreviewReferenceSource[],
  client: InboxDataClient,
) {
  const references = useMemo(
    () => collectInboxPreviewReferences(conversations),
    [conversations],
  );

  const { data: eventTitleMap = {} } = useQuery({
    queryKey: ["messages-page-event-titles", references.eventIds.join(",")],
    queryFn: () => fetchInboxEventTitleMap(references.eventIds, client),
    enabled: references.eventIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vaultFolderNameMap = {} } = useQuery({
    queryKey: ["messages-page-vault-folder-names", references.vaultFolderIds.join(",")],
    queryFn: () => fetchInboxVaultFolderNameMap(references.vaultFolderIds, client),
    enabled: references.vaultFolderIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vaultFileNameMap = {} } = useQuery({
    queryKey: ["messages-page-vault-file-names", references.vaultFileIds.join(",")],
    queryFn: () => fetchInboxVaultFileNameMap(references.vaultFileIds, client),
    enabled: references.vaultFileIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  return { eventTitleMap, vaultFolderNameMap, vaultFileNameMap };
}
