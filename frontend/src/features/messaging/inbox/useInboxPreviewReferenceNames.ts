import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { collectInboxPreviewReferences, type InboxPreviewReferenceSource } from "./inboxPreviewReferences";
import {
  fetchInboxEventTitleMap,
  fetchInboxVaultFileNameMap,
  fetchInboxVaultFolderNameMap,
} from "./inboxRepositories";
import { resolveAuthBackend } from "@/live/authBackendMode";

/** Internet Identity: resolve titles from the caller-scoped events_domain list. */
async function fetchIcpEventTitleMap(eventIds: readonly string[]): Promise<Record<string, string>> {
  const [{ withFeatureBackend }, { listLiveEvents }] = await Promise.all([
    import("@/live/featureRouter"),
    import("@/live/features/events"),
  ]);
  const wanted = new Set(eventIds.map((id) => id.toLowerCase()));
  return withFeatureBackend("events", {
    supabase: async () => ({}),
    icp: async (ctx) => {
      const rows = (await listLiveEvents(ctx)) as unknown as Array<{ id?: string; title?: string }>;
      const titles: Record<string, string> = {};
      for (const e of rows) {
        const id = String(e.id ?? "").toLowerCase();
        if (id && wanted.has(id) && e.title) titles[id] = String(e.title);
      }
      return titles;
    },
  }, { shared: "person" });
}

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
    queryFn: () => resolveAuthBackend() === "icp"
      ? fetchIcpEventTitleMap(references.eventIds)
      : fetchInboxEventTitleMap(references.eventIds, client),
    enabled: references.eventIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vaultFolderNameMap = {} } = useQuery({
    queryKey: ["messages-page-vault-folder-names", references.vaultFolderIds.join(",")],
    queryFn: () => fetchInboxVaultFolderNameMap(references.vaultFolderIds, client),
    enabled: references.vaultFolderIds.length > 0 && resolveAuthBackend() !== "icp",
    staleTime: 5 * 60 * 1000,
  });

  const { data: vaultFileNameMap = {} } = useQuery({
    queryKey: ["messages-page-vault-file-names", references.vaultFileIds.join(",")],
    queryFn: () => fetchInboxVaultFileNameMap(references.vaultFileIds, client),
    enabled: references.vaultFileIds.length > 0 && resolveAuthBackend() !== "icp",
    staleTime: 5 * 60 * 1000,
  });

  return { eventTitleMap, vaultFolderNameMap, vaultFileNameMap };
}
