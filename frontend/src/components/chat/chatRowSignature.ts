import { getCachedImageAspectRatio } from "@/lib/chatImageAspectCache";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";

type SignatureMessage = {
  id?: string | null;
  author_id?: string | null;
  authorId?: string | null;
  text?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  created_at?: string | null;
  edited_at?: string | null;
  is_edited?: boolean | null;
  is_system_message?: boolean | null;
  author_name?: string | null;
  author?: { display_name?: string | null } | null;
  profiles?: { display_name?: string | null } | null;
  reply_to?: { id?: string } | null;
  reply_to_id?: string | null;
  reactions?: Array<{ emoji?: string; user_id?: string } | unknown> | null;
  link_preview?: unknown;
  link_previews?: unknown;
  preview?: unknown;
  __readStateSignature?: string;
};

function messageDay(value?: string | null) {
  return value ? new Date(value).toDateString() : "";
}

/**
 * Compactly identify every message or neighbouring-row field that can change
 * rendered height. A changed signature invalidates a stale measured-height
 * cache entry before Virtuoso remounts the row.
 */
export function createChatRowSignature(
  message: unknown,
  index?: number,
  messages?: unknown[],
  currentUserId?: string | null,
): string {
  const m = (message ?? {}) as SignatureMessage;
  const prev = (typeof index === "number" && messages ? messages[index - 1] : undefined) as
    | SignatureMessage
    | undefined;
  const next = (typeof index === "number" && messages ? messages[index + 1] : undefined) as
    | SignatureMessage
    | undefined;
  const currentDay = messageDay(m.created_at);
  const prevDay = messageDay(prev?.created_at);
  const hasDateSeparator = !!currentDay && (!prevDay || prevDay !== currentDay);
  const groupedWithPrev = !!prev && shouldGroupWithPrev(m, prev);
  const groupedWithNext = !!next && shouldGroupWithPrev(next, m);
  const isOwnMessage = !!currentUserId && m.author_id === currentUserId;
  const authorName = m.author_name ?? m.author?.display_name ?? m.profiles?.display_name ?? "";
  const text = m.text ?? "";
  const img = m.image_url ?? m.imageUrl ?? "";
  const edited = m.edited_at ?? (m.is_edited ? "1" : "");
  const replyId = m.reply_to?.id || m.reply_to_id || "";

  let reactionCount = 0;
  let reactionEmojiLength = 0;
  if (Array.isArray(m.reactions)) {
    reactionCount = m.reactions.length;
    for (const reaction of m.reactions) {
      const emoji = (reaction as { emoji?: string })?.emoji;
      if (typeof emoji === "string") reactionEmojiLength += emoji.length;
    }
  }

  const aspect = img ? (getCachedImageAspectRatio([img])?.toFixed(3) ?? "0") : "";
  const previewShape =
    (m.link_preview ? 1 : 0) | (m.link_previews ? 2 : 0) | (m.preview ? 4 : 0);

  return `${text.length}:${text.slice(0, 64)}|${img.length}:${aspect}|${edited}|${replyId}|${reactionCount}.${reactionEmojiLength}|${previewShape}|ctx:${hasDateSeparator ? 1 : 0}.${groupedWithPrev ? 1 : 0}.${groupedWithNext ? 1 : 0}.${isOwnMessage ? 1 : 0}.${authorName.length}.${m.__readStateSignature ?? ""}`;
}
