import { getCachedImageAspectRatio } from "@/lib/chatImageAspectCache";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";
import { getCachedRowHeight } from "./chatRowHeightCache";
import {
  CHAT_PREVIEW_HEIGHT_BY_TOKEN,
  estimateExternalChatPreviewHeight,
  estimateVisibleChatText,
} from "./chatRowPreviewEstimate";
import { createChatRowSignature } from "./chatRowSignature";

type EstimableChatMessage = {
  id: string;
  author_id?: string | null;
  text?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  created_at?: string | null;
  reply_to?: unknown;
  reply_to_id?: string | null;
  reactions?: unknown[] | null;
  is_system_message?: boolean | null;
  author_name?: string | null;
  author?: { display_name?: string | null } | null;
  profiles?: { display_name?: string | null } | null;
  edited_at?: string | null;
  is_edited?: boolean | null;
};

function messageDay(value?: string | null) {
  return value ? new Date(value).toDateString() : "";
}

let cachedOwnCharsPerLine = 0;
let cachedIncomingCharsPerLine = 0;
let cachedViewportWidth = 0;

function getCharsPerLine(isOwnMessage: boolean) {
  const width = typeof window !== "undefined" ? window.innerWidth : 411;
  if (width !== cachedViewportWidth) {
    cachedViewportWidth = width;
    const rowWidth = Math.max(260, width - 32);
    const ownInner = Math.max(140, rowWidth * 0.82 - 24);
    const incomingInner = Math.max(130, rowWidth * 0.85 - 44 - 24);
    cachedOwnCharsPerLine = Math.max(14, Math.floor(ownInner / 7.4));
    cachedIncomingCharsPerLine = Math.max(14, Math.floor(incomingInner / 7.4));
  }
  return isOwnMessage ? cachedOwnCharsPerLine : cachedIncomingCharsPerLine;
}

/** Estimate a virtualized chat row without reading or mutating scroll state. */
export function estimateChatRowHeight<TMessage extends { id: string }>(
  message: TMessage,
  index: number,
  messages: TMessage[],
  currentUserId?: string | null,
) {
  const signature = createChatRowSignature(message, index, messages, currentUserId);
  const cached = getCachedRowHeight(message.id, signature);
  if (cached !== undefined) return cached;

  const msg = message as TMessage & EstimableChatMessage;
  const prev = messages[index - 1] as (TMessage & EstimableChatMessage) | undefined;
  const next = messages[index + 1] as (TMessage & EstimableChatMessage) | undefined;
  let height = 16;
  const groupedWithPrev = !!prev && shouldGroupWithPrev(msg, prev);
  const groupedWithNext = !!next && shouldGroupWithPrev(next, msg);
  if (groupedWithPrev) height -= 12;

  if (msg.created_at) {
    const currentDay = messageDay(msg.created_at);
    const previousDay = messageDay(prev?.created_at);
    if (!previousDay || previousDay !== currentDay) height += 56;
  }

  const text = (msg.text || "").trim();
  const hasImage = !!(msg.image_url || msg.imageUrl);
  const hasReply = !!(msg.reply_to || msg.reply_to_id);
  const reactions = Array.isArray(msg.reactions) ? msg.reactions.length : 0;

  const systemGalleryCardMatch = msg.is_system_message
    ? text.match(/^\s*\[(gallery|galleryprompt):[0-9a-f-]{36}\]\s*$/i)
    : null;
  if (systemGalleryCardMatch) {
    return height + (systemGalleryCardMatch[1]?.toLowerCase() === "galleryprompt" ? 76 : 240);
  }
  if (msg.is_system_message) return Math.max(52, height + 36);

  const isOwnMessage = !!currentUserId && msg.author_id === currentUserId;
  if (!isOwnMessage && !groupedWithPrev) {
    const authorLength = (
      msg.author_name ?? msg.author?.display_name ?? msg.profiles?.display_name ?? "Loading..."
    ).length;
    height += authorLength > 24 ? 36 : 24;
  }

  if (hasReply) height += 70;

  if (hasImage) {
    const imageUrl = (msg.image_url || msg.imageUrl) ?? null;
    const ratio = getCachedImageAspectRatio([imageUrl]) ?? (4 / 3);
    height += Math.round(300 / ratio);
  }

  const visibleText = estimateVisibleChatText(text);
  if (visibleText) {
    const charsPerLine = getCharsPerLine(isOwnMessage);
    let lineCount = 0;
    for (const line of visibleText.split(/\n/)) {
      lineCount += Math.max(1, Math.ceil(line.length / charsPerLine));
    }
    height += lineCount * 18;
  } else if (!hasImage) {
    height += 32;
  }

  const tokenMatches = text.matchAll(
    /\[(event|poll|board|vault|vaultfolder|vaultroot|gallery|galleryprompt):[^\]]+\]/gi,
  );
  let previewHeight = 0;
  let previewCount = 0;
  for (const match of tokenMatches) {
    if (previewCount >= 3) break;
    previewHeight += CHAT_PREVIEW_HEIGHT_BY_TOKEN[(match[1] || "").toLowerCase()] ?? 96;
    previewCount += 1;
  }
  previewHeight += estimateExternalChatPreviewHeight(text);
  height += previewHeight;

  if (visibleText || hasReply || previewHeight > 0) height += groupedWithNext ? 4 : 8;
  else if (hasImage) height += groupedWithNext ? 18 : 34;

  if (reactions) height += Math.ceil(reactions / 4) * 28;
  if (msg.edited_at || msg.is_edited) height += 4;

  return Math.max(56, Math.min(1400, height));
}
