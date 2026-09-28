import type { InboxPreviewMessage } from "./inboxReadModel";

export type InboxRealtimeScope = "team" | "club" | "group" | "dm";

export interface InboxAuthorizationSnapshot {
  status: "loading" | "ready" | "failed";
  teamIds: ReadonlySet<string>;
  clubIds: ReadonlySet<string>;
  groupIds: ReadonlySet<string>;
  dmIds: ReadonlySet<string>;
}

interface RealtimeMessageRow {
  text?: string | null;
  created_at: string;
  image_url?: string | null;
  author_id?: string | null;
  conversation_id?: string | null;
}

interface LatestMessagesCache {
  latestMessages?: Record<string, InboxPreviewMessage | undefined>;
}

export function isAuthorizedInboxScope(
  kind: InboxRealtimeScope,
  id: string | null | undefined,
  snapshot: InboxAuthorizationSnapshot,
): boolean {
  if (!id) return false;
  if (snapshot.status !== "ready") return false;
  const set =
    kind === "team" ? snapshot.teamIds :
    kind === "club" ? snapshot.clubIds :
    kind === "group" ? snapshot.groupIds :
    snapshot.dmIds;
  return set.has(id);
}

export function buildRealtimePreview(
  row: RealtimeMessageRow,
  author: string,
  extra: Partial<InboxPreviewMessage> = {},
): InboxPreviewMessage {
  return {
    text: row.text ?? "",
    author,
    created_at: row.created_at,
    image_url: row.image_url ?? null,
    ...extra,
  };
}

export function mergeLatestMessagesPreview<T extends LatestMessagesCache | undefined>(
  old: T,
  targetId: string,
  preview: InboxPreviewMessage,
  options: { createIfMissing: boolean } = { createIfMissing: false },
): T | (LatestMessagesCache & Record<string, unknown>) {
  if (!old && !options.createIfMissing) return old;
  const base = old ?? { latestMessages: {} };
  return {
    ...base,
    latestMessages: {
      ...(base.latestMessages || {}),
      [targetId]: preview,
    },
  };
}

export function moveDirectConversationToTop<T extends { id: string; updated_at?: string; last_message?: unknown }>(
  old: T[] | undefined,
  row: RealtimeMessageRow,
): T[] | undefined {
  if (!Array.isArray(old) || !row.conversation_id) return old;
  const idx = old.findIndex((conversation) => conversation.id === row.conversation_id);
  if (idx === -1) return old;
  const conversation = old[idx];
  const updated = {
    ...conversation,
    updated_at: row.created_at,
    last_message: {
      text: row.text ?? "",
      image_url: row.image_url ?? null,
      created_at: row.created_at,
      author_id: row.author_id,
    },
  };
  const next = old.slice();
  next.splice(idx, 1);
  next.unshift(updated);
  return next;
}

export function patchDirectConversationEdit<T extends { id: string; last_message?: { created_at?: string; text?: string; image_url?: string | null } }>(
  old: T[] | undefined,
  row: RealtimeMessageRow,
): T[] | undefined {
  if (!Array.isArray(old) || !row.conversation_id) return old;
  const idx = old.findIndex((conversation) => conversation.id === row.conversation_id);
  if (idx === -1) return old;
  const conversation = old[idx];
  if (conversation.last_message?.created_at !== row.created_at) return old;
  const next = old.slice();
  next[idx] = {
    ...conversation,
    last_message: {
      ...conversation.last_message,
      text: row.text ?? "",
      image_url: row.image_url ?? null,
    },
  };
  return next;
}
