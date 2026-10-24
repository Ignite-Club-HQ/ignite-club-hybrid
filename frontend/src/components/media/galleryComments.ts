export interface GalleryComment {
  id: string;
  text: string;
  user_id: string;
  created_at: string;
  reply_to_id?: string | null;
  profiles?: { display_name?: string | null; avatar_url?: string | null } | null;
}

export function galleryCommentFromReceipt(comment: {
  id: string; body: string; author: { toText(): string }; created_at_ms: bigint; reply_to_id?: [] | [string];
}): GalleryComment {
  return {
    id: comment.id, text: comment.body, user_id: comment.author.toText(),
    created_at: new Date(Number(comment.created_at_ms)).toISOString(),
    ...(comment.reply_to_id ? { reply_to_id: comment.reply_to_id[0] ?? null } : {}),
  };
}

/** Reconcile by acknowledged ID, never text: different members can say the same thing. */
export function mergeGalleryComments(read: GalleryComment[], local: GalleryComment[]): GalleryComment[] {
  const byId = new Map(read.map(comment => [comment.id, comment]));
  for (const comment of local) if (!byId.has(comment.id)) byId.set(comment.id, comment);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}