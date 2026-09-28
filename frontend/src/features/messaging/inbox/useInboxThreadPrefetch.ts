import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { buildInboxPrefetchJobs } from "./inboxPrefetch";

interface InboxDataClient {
  from: (table: string) => any;
}

interface UseInboxThreadPrefetchOptions {
  enabled: boolean;
  queryClient: QueryClient;
  client: InboxDataClient;
  teamIds: readonly string[];
  clubIds: readonly string[];
  groupIds: readonly string[];
  cap: number;
  messagesPerPage: number;
  isNativeRuntime: () => boolean;
}

export function useInboxThreadPrefetch({
  enabled,
  queryClient,
  client,
  teamIds,
  clubIds,
  groupIds,
  cap,
  messagesPerPage,
  isNativeRuntime,
}: UseInboxThreadPrefetchOptions) {
  useEffect(() => {
    if (!enabled || isNativeRuntime()) return;

    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const prefetchAll = () => {
      if (cancelled) return;
      const jobs = buildInboxPrefetchJobs({ teamIds, clubIds, groupIds, cap });
      jobs.forEach((job) => {
        if (cancelled) return;
        queryClient.prefetchQuery({
          queryKey: job.queryKey,
          queryFn: async () => {
            let query = client.from(job.table).select(job.select);
            if (job.scope) query = query.eq(job.scope.column, job.scope.value);
            const { data } = await query.order("created_at", { ascending: false }).limit(messagesPerPage + 1);
            if (!data?.length) return { messages: [], hasOlderMessages: false };
            const hasOlderMessages = data.length > messagesPerPage;
            return {
              messages: [...(hasOlderMessages ? data.slice(0, messagesPerPage) : data)].reverse(),
              hasOlderMessages,
            };
          },
          staleTime: 60_000,
        });
      });
    };

    if ("requestIdleCallback" in window) {
      idleHandle = (window as any).requestIdleCallback(prefetchAll, { timeout: 2000 });
    } else {
      timeoutHandle = setTimeout(prefetchAll, 100);
    }
    return () => {
      cancelled = true;
      if (idleHandle !== null && "cancelIdleCallback" in window) {
        try {
          (window as any).cancelIdleCallback(idleHandle);
        } catch {
          // A browser can discard an idle callback before cancellation.
        }
      }
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    };
  }, [enabled, queryClient, client, teamIds, clubIds, groupIds, cap, messagesPerPage, isNativeRuntime]);
}
