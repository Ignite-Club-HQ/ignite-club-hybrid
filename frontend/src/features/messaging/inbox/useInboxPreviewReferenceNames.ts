import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { collectInboxPreviewReferences, type InboxPreviewReferenceSource } from "./inboxPreviewReferences";
import {
  fetchInboxEventTitleMap,
  fetchInboxVaultFileNameMap,
  fetchInboxVaultFolderNameMap,
} from "./inboxRepositories";
import { isFeatureRoutedToIcp } from '@/live/loadBackendRouting';
import { useAuth } from '@/hooks/useAuth';
import { fetchIcpEventTitleMap, fetchIcpVaultNameMap } from './icpPreviewReferenceNames';

type InboxDataClient = NonNullable<Parameters<typeof fetchInboxEventTitleMap>[1]>;

export function useInboxPreviewReferenceNames(
  conversations: readonly InboxPreviewReferenceSource[],
  client: InboxDataClient,
) {
  const { user } = useAuth();
  const eventsOnIcp = isFeatureRoutedToIcp('events');
  const vaultOnIcp = isFeatureRoutedToIcp('vault');
  const references = useMemo(
    () => collectInboxPreviewReferences(conversations),
    [conversations],
  );

  const { data: eventTitleMap = {} } = useQuery({
    queryKey: ["messages-page-event-titles", user?.id, eventsOnIcp, references.eventIds.join(",")],
    queryFn: () => eventsOnIcp
      ? fetchIcpEventTitleMap(references.eventIds)
      : fetchInboxEventTitleMap(references.eventIds, client),
    enabled: !!user && references.eventIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vaultFolderNameMap = {} } = useQuery({
    queryKey: ["messages-page-vault-folder-names", user?.id, vaultOnIcp, references.vaultFolderIds.join(",")],
    queryFn: () => vaultOnIcp ? fetchIcpVaultNameMap(references.vaultFolderIds, 'folder') : fetchInboxVaultFolderNameMap(references.vaultFolderIds, client),
    enabled: !!user && references.vaultFolderIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vaultFileNameMap = {} } = useQuery({
    queryKey: ["messages-page-vault-file-names", user?.id, vaultOnIcp, references.vaultFileIds.join(",")],
    queryFn: () => vaultOnIcp ? fetchIcpVaultNameMap(references.vaultFileIds, 'file') : fetchInboxVaultFileNameMap(references.vaultFileIds, client),
    enabled: !!user && references.vaultFileIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  return { eventTitleMap, vaultFolderNameMap, vaultFileNameMap };
}
