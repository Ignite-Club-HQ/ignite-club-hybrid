function looksLikeYoutubeUrl(text: string) {
  return /(?:youtube\.com\/(?:watch\?|shorts\/|embed\/)|youtu\.be\/)/i.test(text);
}

const PLAIN_URL_REGEX = /(?:https?:\/\/|www\.)[^\s\]]+/gi;

/**
 * Per-preview reserved heights used by the virtualized chat estimator.
 * These values mirror the first-paint skeleton dimensions of each card.
 * Under-reserving produces late upward corrections; over-reserving produces
 * downward corrections, so keep these aligned with rendered card geometry.
 */
export const CHAT_PREVIEW_HEIGHT_BY_TOKEN: Readonly<Record<string, number>> = {
  event: 76,
  poll: 180,
  board: 80,
  vault: 64,
  vaultfolder: 64,
  vaultroot: 64,
  gallery: 240,
  galleryprompt: 76,
  url: 80,
};

/**
 * Return only the text that contributes to normal bubble wrapping. Rich chat
 * tokens are measured separately, while labels from mentions and links remain
 * visible and therefore still contribute to text height.
 */
export function estimateVisibleChatText(rawText: string) {
  return rawText
    .replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/(?:https?:\/\/[^\s]*)?\/events\/[0-9a-f-]{36}(?:\S*)?/gi, "")
    .replace(/\[(event|poll|board|vault|vaultfolder|vaultroot|gallery|galleryprompt):[^\]]+\]/gi, "")
    .replace(PLAIN_URL_REGEX, (url) => looksLikeYoutubeUrl(url) ? "" : "x".repeat(Math.min(50, url.length)))
    .trim();
}

/** Reserve space for at most two unique YouTube cards and two other links. */
export function estimateExternalChatPreviewHeight(text: string) {
  const seen = new Set<string>();
  let youtubeCount = 0;
  let otherCount = 0;
  for (const match of text.matchAll(PLAIN_URL_REGEX)) {
    const url = match[0];
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (looksLikeYoutubeUrl(url)) {
      if (youtubeCount < 2) youtubeCount += 1;
    } else if (otherCount < 2) {
      otherCount += 1;
    }
  }
  const youtubeHeight = youtubeCount * 180 + Math.max(0, youtubeCount - 1) * 8;
  const linkHeight = otherCount * CHAT_PREVIEW_HEIGHT_BY_TOKEN.url + Math.max(0, otherCount - 1) * 8;
  return youtubeHeight + linkHeight;
}
