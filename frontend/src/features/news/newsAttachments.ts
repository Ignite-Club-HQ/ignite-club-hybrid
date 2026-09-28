/**
 * Club News attachments.
 *
 * Stored on `club_news.attachments` as a JSON array so we don't need a new
 * table or bucket: files live in the existing public `club-logos` bucket under
 * `news/<clubId>/...`, the same path news header images already use.
 */
export interface NewsAttachment {
  kind: "image" | "file";
  url: string;
  name: string;
  /** Bytes, when known. */
  size?: number | null;
  mimeType?: string | null;
  /**
   * Stable key referenced by an inline token in the article body
   * (`{{attachment:<anchor>}}`). When present the attachment renders at that
   * exact spot in the content instead of in the trailing gallery/list.
   */
  anchor?: string | null;
}

/** Defensive parse — the column is free-form jsonb. */
export function parseNewsAttachments(raw: unknown): NewsAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: NewsAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const url = typeof rec.url === "string" ? rec.url : null;
    if (!url) continue;
    const kind = rec.kind === "image" ? "image" : "file";
    out.push({
      kind,
      url,
      name: typeof rec.name === "string" && rec.name ? rec.name : kind === "image" ? "Image" : "File",
      size: typeof rec.size === "number" ? rec.size : null,
      mimeType: typeof rec.mimeType === "string" ? rec.mimeType : null,
      anchor: typeof rec.anchor === "string" && rec.anchor ? rec.anchor : null,
    });
  }
  return out;
}

/** Inline placement token, e.g. `{{attachment:9f3c...}}`. */
export const attachmentToken = (anchor: string) => `{{attachment:${anchor}}}`;

const TOKEN_RE = /\{\{attachment:([A-Za-z0-9._-]+)\}\}/g;

export type NewsBodySegment =
  | { type: "text"; text: string }
  | { type: "attachment"; attachment: NewsAttachment };

/**
 * Splits article content into text runs and inline attachments, and reports
 * which attachments were consumed inline so the caller can render the rest
 * (unplaced ones) at the end.
 */
export function splitNewsBody(
  content: string,
  attachments: NewsAttachment[],
): { segments: NewsBodySegment[]; usedAnchors: Set<string> } {
  const byAnchor = new Map<string, NewsAttachment>();
  attachments.forEach((a) => {
    if (a.anchor) byAnchor.set(a.anchor, a);
  });

  const segments: NewsBodySegment[] = [];
  const usedAnchors = new Set<string>();
  let cursor = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(content))) {
    const attachment = byAnchor.get(match[1]);
    const text = content.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    if (text) segments.push({ type: "text", text });
    if (attachment) {
      segments.push({ type: "attachment", attachment });
      usedAnchors.add(match[1]);
    }
  }
  const tail = content.slice(cursor);
  if (tail) segments.push({ type: "text", text: tail });
  return { segments, usedAnchors };

}

/** Strips inline tokens for plain-text contexts (previews, chat excerpts). */
export function stripAttachmentTokens(content: string): string {
  return content.replace(TOKEN_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}


export function formatFileSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const NEWS_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const NEWS_MAX_IMAGES = 8;
export const NEWS_MAX_FILES = 5;
