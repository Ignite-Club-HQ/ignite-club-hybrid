/** Keep the already displayed portion while sources refresh independently.
 * Ready sources replace their refreshed range; denial removes their rows. */
export function retainMediaFeed<T extends {
  posts: { id: string; clubId: string; createdAtMs: number }[];
  sources?: { clubId: string; state: string }[];
  hasMore?: boolean;
}>(previous: T | undefined, next: T): T {
  if (!previous || !next.sources) return next;
  const rows = new Map(next.posts.map(post => [post.id, post]));
  for (const source of next.sources) {
    if (source.state === 'denied') continue;
    const refreshed = next.posts.filter(post => post.clubId === source.clubId);
    const oldest = Math.min(...refreshed.map(post => post.createdAtMs));
    for (const post of previous.posts) {
      if (post.clubId !== source.clubId || rows.has(post.id)) continue;
      if (source.state !== 'ready' || (next.hasMore && refreshed.length > 0 && post.createdAtMs < oldest)) rows.set(post.id, post);
    }
  }
  return { ...next, posts: [...rows.values()].sort((a, b) => b.createdAtMs - a.createdAtMs) };
}