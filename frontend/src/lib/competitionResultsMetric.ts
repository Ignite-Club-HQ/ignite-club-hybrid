/** "Results entered" counts only matches whose canonical status is completed. */
export function countCompletedMatches(matches: ReadonlyArray<{ status?: unknown }> | null | undefined): number {
  return (matches ?? []).filter((m) => m?.status === "completed").length;
}
