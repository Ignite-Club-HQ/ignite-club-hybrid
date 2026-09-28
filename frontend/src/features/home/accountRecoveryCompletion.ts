import type { QueryClient } from "@tanstack/react-query";

/**
 * Account recovery only clears profiles.scheduled_deletion_at. The banner owns
 * its local visibility, while app-admin user search is the only query-backed
 * consumer of that field. Do not broaden this into a whole-app refetch.
 */
export function completeHomeAccountRecovery(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["search-users-manage"] });
}
