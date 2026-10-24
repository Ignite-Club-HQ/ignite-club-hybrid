import type { QueryClient } from "@tanstack/react-query";
import { buildRealtimePreview, mergeLatestMessagesPreview } from "./inboxRealtimeCache";
import type { InboxPreviewMessage } from "./inboxReadModel";

type Scope = "team" | "club" | "group";
type InboxData = {
  teams?: { id: string }[];
  clubs?: { id: string }[];
  groups?: { id: string }[];
  latestMessages?: Record<string, InboxPreviewMessage>;
};
const prefixes = { team: "my-teams-with-messages", club: "member-clubs-with-messages", group: "my-chat-groups-with-messages" };
const collections = { team: "teams", club: "clubs", group: "groups" } as const;
type Mark = { targetId: string; preview: InboxPreviewMessage };
const clients = new WeakMap<QueryClient, Map<string, Map<string, Mark>>>();
const timestamp = (preview?: InboxPreviewMessage) => Date.parse(preview?.created_at ?? "") || 0;

/** Only acknowledged sends and already-listed, exact-account conversations. */
export function applyConfirmedInboxPreview(
  client: QueryClient,
  scope: Scope,
  userId: string | undefined,
  targetId: string | undefined,
  saved: { text: string; image_url: string | null; created_at: string },
): void {
  if (!userId || !targetId) return;
  const queryKey = [prefixes[scope], userId];
  const query = client.getQueryCache().find({ queryKey, exact: true });
  const data = query?.state.data as InboxData | undefined;
  if (!query || !data?.[collections[scope]]?.some((row) => row.id === targetId)) return;
  const preview = buildRealtimePreview(saved, "You");
  if (timestamp(data.latestMessages?.[targetId]) > timestamp(preview)) return;

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
      let current = event.query.state.data as InboxData | undefined;
      for (const [id, mark] of pending) {
        const latest = current?.latestMessages?.[id];
        if (timestamp(latest) > timestamp(mark.preview)) {
          pending.delete(id);
        } else if (current && timestamp(latest) < timestamp(mark.preview)) {
          current = mergeLatestMessagesPreview(current, id, mark.preview) as InboxData;
        }
      }
      if (pending.size === 0) ownedMarks.delete(event.query.queryHash);
      if (current !== event.query.state.data) client.setQueryData(event.query.queryKey, current);
    });
  }
  let pending = marks.get(query.queryHash);
  if (!pending) marks.set(query.queryHash, (pending = new Map()));
  pending.set(targetId, { targetId, preview });
  if (pending.size > 300) {
    const oldest = pending.keys().next().value;
    if (oldest) pending.delete(oldest);
  }
  client.setQueryData(queryKey, mergeLatestMessagesPreview(data, targetId, preview));
}