import type { QueryClient } from "@tanstack/react-query";
import {
  buildRealtimePreview,
  mergeLatestMessagesPreview,
  moveDirectConversationToTop,
} from "./inboxRealtimeCache";
import type { InboxPreviewMessage } from "./inboxReadModel";

/**
 * Shows still-sending messages in the Messages inbox preview the moment the
 * send button is tapped, instead of waiting for the (slow ICP) write to be
 * acknowledged. Mirrors confirmedInboxPreview: the pending preview is
 * registered as a mark so background refetches cannot wipe it while the send
 * is in flight; settle (ack) or discard (failure) removes it.
 */

type Scope = "team" | "club" | "group";
type AnyScope = Scope | "dm";

const prefixes = {
  team: "my-teams-with-messages",
  club: "member-clubs-with-messages",
  group: "my-chat-groups-with-messages",
} as const;
const collections = { team: "teams", club: "clubs", group: "groups" } as const;
const dmPrefix = "dm-conversations";

export interface PendingPreviewInput {
  text: string;
  image_url: string | null;
}

export interface PendingDmSaved {
  text: string;
  image_url: string | null;
  created_at: string;
}

interface DmPrevious {
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string | null;
}

type Mark = {
  preview: InboxPreviewMessage;
  /** Team/club/group only: preview the conversation had before the send. */
  previous: InboxPreviewMessage | null;
  /** DM only: exact previous row state so a failed send restores it. */
  previousDm: DmPrevious | null;
  previousUpdatedAt: string | undefined;
};

const clients = new WeakMap<QueryClient, Map<string, Map<string, Mark>>>();
const timestamp = (preview?: InboxPreviewMessage) => Date.parse(preview?.created_at ?? "") || 0;
const markKey = (scope: AnyScope, userId: string, targetId: string) => `${scope}:${userId}:${targetId}`;

function markMapFor(client: QueryClient): Map<string, Map<string, Mark>> {
  let marks = clients.get(client);
  if (!marks) {
    marks = new Map();
    clients.set(client, marks);
    const ownedMarks = marks;
    client.getQueryCache().subscribe((event) => {
      if (event.type === "removed") {
        ownedMarks.delete(event.query.queryHash);
        return;
      }
      if (event.type !== "updated" || event.action.type !== "success") return;
      const pending = ownedMarks.get(event.query.queryHash);
      if (!pending) return;
      const data = event.query.state.data;
      let changed = false;
      for (const [key, mark] of pending) {
        const [scope, userId, targetId] = key.split(":") as [AnyScope, string, string];
        if (scope === "dm") {
          const row = (data as { id: string }[] | undefined)?.find?.((row) => row.id === targetId);
          const last = (row as { last_message?: { created_at?: string } } | undefined)?.last_message;
          if (timestamp(last as unknown as InboxPreviewMessage) > timestamp(mark.preview)) {
            pending.delete(key);
          }
          continue;
        }
        const current = (data as { latestMessages?: Record<string, InboxPreviewMessage> } | undefined)?.latestMessages?.[targetId];
        if (timestamp(current) > timestamp(mark.preview)) {
          pending.delete(key);
          changed = true;
        }
      }
      if (changed && pending.size === 0) ownedMarks.delete(event.query.queryHash);
    });
  }
  return marks;
}

/** Write the pending preview into the inbox caches so the row updates at once. */
export function applyPendingInboxPreview(
  client: QueryClient,
  scope: AnyScope,
  userId: string | undefined,
  targetId: string | undefined,
  input: PendingPreviewInput,
): void {
  if (!userId || !targetId) return;
  const preview = buildRealtimePreview(
    { text: input.text, image_url: input.image_url, created_at: new Date().toISOString() },
    "You",
    scope === "dm" ? { author_id: userId } : {},
  );

  if (scope === "dm") {
    const key = [dmPrefix, userId];
    const data = client.getQueryData<{ id: string; updated_at?: string; last_message?: DmPrevious | null }[]>(key);
    const row = data?.find((row) => row.id === targetId);
    if (!data || !row) return;
    const marks = markMapFor(client);
    const query = client.getQueryCache().find({ queryKey: key, exact: true })!;
    let pending = marks.get(query.queryHash);
    if (!pending) marks.set(query.queryHash, (pending = new Map()));
    pending.set(markKey(scope, userId, targetId), {
      preview,
      previous: null,
      previousDm: row.last_message ?? null,
      previousUpdatedAt: row.updated_at,
    });
    if (pending.size > 300) {
      const oldest = pending.keys().next().value;
      if (oldest) pending.delete(oldest);
    }
    client.setQueryData(key, (old: typeof data) => moveDirectConversationToTop(old, preview));
    return;
  }

  const key = [prefixes[scope], userId];
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  const data = query?.state.data as { [key: string]: { id: string }[] | undefined; latestMessages?: Record<string, InboxPreviewMessage> } | undefined;
  if (!query || !data?.[collections[scope]]?.some((row) => row.id === targetId)) return;
  const previous = data.latestMessages?.[targetId] ?? null;
  const marks = markMapFor(client);
  let pending = marks.get(query.queryHash);
  if (!pending) marks.set(query.queryHash, (pending = new Map()));
  pending.set(markKey(scope, userId, targetId), { preview, previous, previousDm: null, previousUpdatedAt: undefined });
  if (pending.size > 300) {
    const oldest = pending.keys().next().value;
    if (oldest) pending.delete(oldest);
  }
  client.setQueryData(query.queryKey, mergeLatestMessagesPreview(data, targetId, preview));
}

/**
 * The send was acknowledged: drop the pending mark so the confirmed copy and
 * later refetches own the preview. For DMs the acknowledged row can replace
 * the pending copy straight away (no confirmed-preview path exists there).
 */
export function settlePendingInboxPreview(
  client: QueryClient,
  scope: AnyScope,
  userId: string | undefined,
  targetId: string | undefined,
  saved?: PendingDmSaved,
): void {
  if (!userId || !targetId) return;
  const key = markKey(scope, userId, targetId);
  if (scope === "dm") {
    if (saved) {
      client.setQueryData([dmPrefix, userId], (old: { id: string }[] | undefined) =>
        moveDirectConversationToTop(old, { ...saved, author_id: userId }),
      );
    }
  }
  for (const pending of markMapFor(client).values()) pending.delete(key);
}

/** The send failed (and is not offline-queued): restore the previous preview. */
export function discardPendingInboxPreview(
  client: QueryClient,
  scope: AnyScope,
  userId: string | undefined,
  targetId: string | undefined,
): void {
  if (!userId || !targetId) return;
  const key = markKey(scope, userId, targetId);
  const marks = markMapFor(client);
  const mark = marks.get(key) ?? [...marks.values()].flatMap((m) => [...m.entries()]).find(([k]) => k === key)?.[1];
  const found = (() => {
    for (const pending of marks.values()) {
      const mark = pending.get(key);
      if (mark) return mark;
    }
    return undefined;
  })();
  if (!found) return;
  for (const pending of marks.values()) pending.delete(key);

  if (scope === "dm") {
    client.setQueryData([dmPrefix, userId], (old: { id: string; updated_at?: string; last_message?: DmPrevious | null }[] | undefined) => {
      if (!Array.isArray(old)) return old;
      return old.map((row) =>
        row.id === targetId
          ? { ...row, updated_at: found.previousUpdatedAt, last_message: found.previousDm }
          : row,
      );
    });
    return;
  }

  const queryKey = [prefixes[scope], userId];
  client.setQueryData(queryKey, (old: { latestMessages?: Record<string, InboxPreviewMessage> } | undefined) => {
    if (!old?.latestMessages) return old;
    const latestMessages = { ...old.latestMessages };
    if (found.previous) latestMessages[targetId] = found.previous;
    else delete latestMessages[targetId];
    return { ...old, latestMessages };
  });
}

/** Test-only: drop every pending mark (keeps current cache contents). */
export function resetPendingInboxPreviewsForTests(): void {
  clients = new WeakMap() as never;
}
