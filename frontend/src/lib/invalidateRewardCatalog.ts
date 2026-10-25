import type { QueryClient } from "@tanstack/react-query";

/** Refresh derived reward views after a catalogue mutation, including inactive pages. */
export async function invalidateRewardCatalog(
  client: QueryClient,
  clubId: string,
): Promise<void> {
  // Invalidate source catalogues before summaries: their refetches use fetchQuery
  // and must not derive the next reward from a still-fresh old catalogue.
  await client.invalidateQueries({
    predicate: ({ queryKey: key }) =>
      (key[0] === "club-rewards" && key[1] === clubId) ||
      (key[0] === "available-rewards" && key[1] === clubId) ||
      (key[0] === "home-available-rewards" && key[3] === clubId),
  });
  await client.invalidateQueries({
    predicate: ({ queryKey: key }) =>
      (key[0] === "next-reward-info" && Array.isArray(key[1]) && key[1].includes(clubId)) ||
      (key[0] === "next-reward-thresholds" && (key[2] == null || key[2] === clubId)),
  });
}