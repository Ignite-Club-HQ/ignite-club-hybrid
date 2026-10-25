import type { QueryClient } from "@tanstack/react-query";
import type { ClubNewsRow } from "@/features/news/useClubNews";

/**
 * Build the [news:...] token for an outgoing chat message. When the picked
 * post is cached (NewsPickerSheet seeds it), embed the owning club as a
 * routing hint — [news:clubId:newsId] — so recipients open the post with one
 * authorized read instead of scanning every club they belong to. The hint
 * never grants access: the owning canister still checks the audience, and
 * plain old [news:uuid] tokens remain valid.
 */
export function buildNewsShareToken(queryClient: QueryClient, newsId: string): string {
  const cached = queryClient.getQueryData<ClubNewsRow | null>(["club-news-post", newsId]);
  return cached?.club_id ? `[news:${cached.club_id}:${newsId}]` : `[news:${newsId}]`;
}
