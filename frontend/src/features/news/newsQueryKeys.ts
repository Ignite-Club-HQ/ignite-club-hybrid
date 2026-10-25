export const newsPostKey = (newsId: string | null | undefined, userId: string | undefined, isIcp: boolean) =>
  ["club-news-post", newsId, userId, isIcp] as const;

export const NEWS_POST_FRESH_MS = 60_000;