import { selectCachedProfilesByIds } from "@/lib/profileCache";
import type { InboxPreviewMessage } from "./inboxReadModel";

export interface InboxLatestMessageRow {
  text: string;
  created_at: string;
  image_url?: string | null;
  author_id?: string | null;
  is_club_announcement?: boolean | null;
  club_announcement_name?: string | null;
}

export async function resolveInboxAuthorNames(
  messages: readonly (InboxLatestMessageRow | null | undefined)[],
  includeMessage: (message: InboxLatestMessageRow) => boolean = (message) => !!message.author_id,
): Promise<Record<string, string>> {
  const authorIds = Array.from(new Set(
    messages
      .filter((message): message is InboxLatestMessageRow => !!message && includeMessage(message))
      .map((message) => message.author_id)
      .filter((id): id is string => !!id),
  ));

  if (authorIds.length === 0) return {};

  const { data: profiles } = await selectCachedProfilesByIds(authorIds);
  const authorNameById: Record<string, string> = {};
  for (const profile of profiles ?? []) {
    if (profile.display_name) authorNameById[profile.id] = profile.display_name;
  }
  return authorNameById;
}

export function toInboxPreviewMessage(
  message: InboxLatestMessageRow,
  authorNameById: Readonly<Record<string, string>>,
): InboxPreviewMessage {
  const isAnnouncement = !!(message.is_club_announcement && message.club_announcement_name);
  const author = isAnnouncement
    ? message.club_announcement_name!
    : (message.author_id ? (authorNameById[message.author_id] ?? "") : "");

  return {
    text: message.text,
    author,
    created_at: message.created_at,
    image_url: message.image_url,
    ...(isAnnouncement ? { is_announcement: true } : null),
  };
}
