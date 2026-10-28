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

let clients = new WeakMap<QueryClient, Map<string, Map<string, Mark>>>();
const timestamp = (preview?: { created_at?: string | null }) => Date.parse(preview?.created_at ?? "") || 0;
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
      let data = event.query.state.data as
        | { latestMessages?: Record<string, InboxPreviewMessage> }
        | { id: string; last_message?: { created_at?: string } }[]
        | undefined;
      let changed = false;
      for (const [key, mark] of pending) {
        const [scope, , targetId] = key.split(":") as [AnyScope, string, string];
        if (scope === "dm") {
          if (!Array.isArray(data)) continue;
          const row = (data as { id: string; last_message?: { created_at?: string } }[]).find((row) => row.id === targetId);
          if (timestamp(row?.last_message) > timestamp(mark.preview)) {
            pending.delete(key);
          } else if (timestamp(row?.last_message) < timestamp(mark.preview)) {
            data = moveDirectConversationToTop(data as { id: string }[], mark.preview) as typeof data;
            changed = true;
          }
          continue;
        }
        const current = (data as { latestMessages?: Record<string, InboxPreviewMessage> } | undefined)?.latestMessages?.[targetId];
        if (timestamp(current) > timestamp(mark.preview)) {
          pending.delete(key);
          changed = true;
        } else if (timestamp(current) < timestamp(mark.preview)) {
          data = mergeLatestMessagesPreview(data as { latestMessages?: Record<string, InboxPreviewMessage> }, targetId, mark.preview) as typeof data;
          changed = true;
        }
      }
      if (changed && data !== event.query.state.data) client.setQueryData(event.query.queryKey, data);
    });
  }
  return marks;
}

function registerMark(marks: Map<string, Map<string, Mark>>, queryHash: string, key: string, mark: Mark): void {
  let pending = marks.get(queryHash);
  if (!pending) marks.set(queryHash, (pending = new Map()));
  pending.set(key, mark);
  if (pending.size > 300) {
    const oldest = pending.keys().next().value;
    if (oldest) pending.delete(oldest);
  }
}

function removeMarkEverywhere(marks: Map<string, Map<string, Mark>>, key: string): void {
  for (const pending of marks.values()) pending.delete(key);
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
  const marks = markMapFor(client);

  if (scope === "dm") {
    const key = [dmPrefix, userId];
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    const data = query?.state.data as { id: string; updated_at?: string; last_message?: DmPrevious | null }[] | undefined;
    const row = data?.find((row) => row.id === targetId);
    if (!query || !data || !row) return;
    registerMark(marks, query.queryHash, markKey(scope, userId, targetId), {
      preview,
      previous: null,
      previousDm: row.last_message ?? null,
      previousUpdatedAt: row.updated_at,
    });
    client.setQueryData(query.queryKey, moveDirectConversationToTop(data, { ...preview, conversation_id: targetId }));
    return;
  }

  const key = [prefixes[scope], userId];
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  const data = query?.state.data as
    | { [key: string]: { id: string }[] | undefined; latestMessages?: Record<string, InboxPreviewMessage> }
    | undefined;
  if (!query || !data?.[collections[scope]]?.some((row) => row.id === targetId)) return;
  registerMark(marks, query.queryHash, markKey(scope, userId, targetId), {
    preview,
    previous: data.latestMessages?.[targetId] ?? null,
    previousDm: null,
    previousUpdatedAt: undefined,
  });
  client.setQueryData(query.queryKey, mergeLatestMessagesPreview(data, targetId, preview));
}

/**
 * The send was acknowledged: drop the pending mark so the confirmed copy and
 * later refetches own the preview. For DMs the acknowledged row replaces the
 * pending copy straight away (no confirmed-preview path exists there).
 */
export function settlePendingInboxPreview(
  client: QueryClient,
  scope: AnyScope,
  userId: string | undefined,
  targetId: string | undefined,
  saved?: PendingDmSaved,
): void {
  if (!userId || !targetId) return;
  if (scope === "dm" && saved) {
    client.setQueryData([dmPrefix, userId], (old: { id: string }[] | undefined) =>
      moveDirectConversationToTop(old, { ...saved, author_id: userId, conversation_id: targetId }),
    );
  }
  removeMarkEverywhere(markMapFor(client), markKey(scope, userId, targetId));
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
  const found = (() => {
    for (const pending of marks.values()) {
      const mark = pending.get(key);
      if (mark) return mark;
    }
    return undefined;
  })();
  if (!found) return;
  removeMarkEverywhere(marks, key);

  if (scope === "dm") {
    client.setQueryData([dmPrefix, userId], (old: { id: string; updated_at?: string; last_message?: DmPrevious | null }[] | undefined) => {
      if (!Array.isArray(old)) return old;
      return old.map((row) => (row.id === targetId ? { ...row, updated_at: found.previousUpdatedAt, last_message: found.previousDm } : row));
    });
    return;
  }

  client.setQueryData([prefixes[scope], userId], (old: { latestMessages?: Record<string, InboxPreviewMessage> } | undefined) => {
    if (!old?.latestMessages) return old;
    const latestMessages = { ...old.latestMessages };
    if (found.previous) latestMessages[targetId] = found.previous;
    else delete latestMessages[targetId];
    return { ...old, latestMessages };
  });
}

/** Test-only: drop every pending mark (keeps current cache contents). */
export function resetPendingInboxPreviewsForTests(): void {
  clients = new WeakMap();
}
