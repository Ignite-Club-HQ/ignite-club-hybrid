import { Fragment, type ReactNode } from "react";

// Same wire format as chat mentions: @[DisplayName](userId)
export const PHOTO_MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

export interface ParsedMention {
  userId: string;
  displayName: string;
}

/** Extract all mentioned user ids from a raw comment string. */
export function extractMentionedUserIds(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(PHOTO_MENTION_REGEX)) {
    if (m[2]) out.add(m[2]);
  }
  return [...out];
}

/** Plain-text version (for previews / notifications fallback). */
export function stripMentionMarkup(text: string): string {
  if (!text) return text;
  return text.replace(PHOTO_MENTION_REGEX, (_m, name: string) => `@${name}`);
}

/** Render text with mentions as styled spans. */
export function renderTextWithMentions(text: string): ReactNode {
  if (!text) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(PHOTO_MENTION_REGEX)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <span
        key={`m-${i++}`}
        className="text-primary font-medium"
      >
        @{m[1]}
      </span>
    );
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
