import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { notificationKeys } from "./notificationQueryKeys";

export type QuerySnapshot<T> = readonly [QueryKey, T | undefined];

export function notificationListFamilyKey(userId?: string): QueryKey {
  return userId
    ? [notificationKeys.lists[0], userId]
    : notificationKeys.lists;
}

export function snapshotAndUpdateQueries<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  updater: (current: T | undefined) => T,
): QuerySnapshot<T>[] {
  const snapshots = queryClient
    .getQueriesData<T>({ queryKey })
    .map(([key, value]) => [key, value] as const);

  queryClient.setQueriesData<T>({ queryKey }, updater);
  return snapshots;
}

export function restoreQuerySnapshots<T>(
  queryClient: QueryClient,
  snapshots: readonly QuerySnapshot<T>[],
): void {
  for (const [key, value] of snapshots) {
    queryClient.setQueryData(key, value);
  }
}

export async function beginNotificationListUpdate<T>(
  queryClient: QueryClient,
  userId: string | undefined,
  updater: (current: T | undefined) => T,
): Promise<QuerySnapshot<T>[]> {
  const queryKey = notificationListFamilyKey(userId);
  await queryClient.cancelQueries({ queryKey });
  return snapshotAndUpdateQueries(queryClient, queryKey, updater);
}

export function invalidateNotificationSurfaces(
  queryClient: QueryClient,
  options: { includeMessageUnread?: boolean } = {},
): void {
  void queryClient.invalidateQueries({ queryKey: notificationKeys.recent });
  void queryClient.invalidateQueries({ queryKey: notificationKeys.lists });
  void queryClient.invalidateQueries({ queryKey: notificationKeys.globalUnread });
  void queryClient.invalidateQueries({ queryKey: notificationKeys.clubUnread });
  if (options.includeMessageUnread) {
    void queryClient.invalidateQueries({
      queryKey: notificationKeys.clubMessageUnread,
    });
    void queryClient.invalidateQueries({ queryKey: notificationKeys.messageUnread });
  }
}
