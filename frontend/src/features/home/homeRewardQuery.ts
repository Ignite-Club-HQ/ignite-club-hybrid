import { queryOptions } from "@tanstack/react-query";
import { fetchAvailableHomeRewardsForBackend } from "./homeRewardsRepository";

/** Bound the visible wait without cancelling/replaying an uncertain remote call. */
export async function readHomeRewardsWithDeadline<T>(read: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Rewards request timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function homeRewardQuery(client: unknown, userId: string | undefined, backend: string, clubId: string | null) {
  return queryOptions({
    queryKey: ["home-available-rewards", userId, backend, clubId],
    queryFn: () => {
      if (!clubId) return Promise.resolve([]);
      return readHomeRewardsWithDeadline(() => fetchAvailableHomeRewardsForBackend(client, null, clubId));
    },
    enabled: !!userId && !!clubId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}