import { useQuery, keepPreviousData, type UseQueryOptions } from "@tanstack/react-query";
import {
  fetchUnreadMessageCounts,
  createEmptyUnreadMessageCounts,
  type UnreadMessageCounts,
} from "@/lib/unreadMessageCounts";
import { Capacitor } from "@capacitor/core";

/**
 * Shared query key for the unread-message-counts RPC. Every consumer
 * (MessagesPage inbox, BottomNav badge, MyTeams carousel) MUST use this exact
 * key so React Query dedupes the underlying `get_unread_message_counts` RPC
 * call across mounted components — previously the RPC was the #1 slow query
 * (~70k calls/day, 54m total) because each consumer fetched independently.
 */
export const UNREAD_MESSAGE_COUNTS_QUERY_KEY = "unread-message-counts" as const;

export const unreadMessageCountsKey = (userId: string | null | undefined) =>
  [UNREAD_MESSAGE_COUNTS_QUERY_KEY, userId] as const;

const isNative = () => Capacitor.isNativePlatform();
const BASE_INTERVAL_MS = isNative() ? 120_000 : 30_000;

/**
 * Jittered refetch interval so background polling from multiple consumers
 * doesn't land on the same tick. ±15%.
 */
const jitteredInterval = () => {
  const base = BASE_INTERVAL_MS;
  return base + (Math.random() * 2 - 1) * (base * 0.15);
};

type Options<TData> = {
  enabled?: boolean;
  select?: (data: UnreadMessageCounts) => TData;
  placeholderData?: UseQueryOptions<UnreadMessageCounts, Error, TData>["placeholderData"];
};

/**
 * Single source of truth for unread-message-count fetches. Dedupes the RPC
 * across all callers. Pass a `select` to derive per-consumer slices without
 * re-fetching.
 *
 * Seeds with `keepPreviousData` + an empty-counts placeholder so:
 * - Cold mounts paint an instant 0-badge instead of blank while the RPC
 *   round-trips (previously ~150-500 ms of visual lag on native).
 * - Re-mounts (nav between tabs) keep the last-known counts visible while
 *   the background refetch runs, so badges never flicker back to 0.
 */
export function useUnreadMessageCounts<TData = UnreadMessageCounts>(
  userId: string | null | undefined,
  options: Options<TData> = {},
) {
  const { enabled = true, select, placeholderData } = options;
  return useQuery<UnreadMessageCounts, Error, TData>({
    queryKey: unreadMessageCountsKey(userId),
    queryFn: () => fetchUnreadMessageCounts(userId!),
    enabled: !!userId && enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: jitteredInterval,
    select,
    placeholderData: placeholderData ?? keepPreviousData,
    initialData: createEmptyUnreadMessageCounts,
    initialDataUpdatedAt: 0,
  });
}

