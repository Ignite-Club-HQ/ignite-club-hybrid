export type InboxPrefetchTable =
  | "broadcast_messages"
  | "team_messages"
  | "club_messages"
  | "group_messages";

export interface InboxPrefetchJob {
  queryKey: string[];
  table: InboxPrefetchTable;
  select: string;
  scope?: {
    column: "team_id" | "club_id" | "group_id";
    value: string;
  };
}

export interface InboxPrefetchSources {
  teamIds: readonly string[];
  clubIds: readonly string[];
  groupIds: readonly string[];
  cap: number;
}

function scopedJobs(
  ids: readonly string[],
  cap: number,
  table: Exclude<InboxPrefetchTable, "broadcast_messages">,
  queryKeyPrefix: "team" | "club" | "group",
  scopeColumn: "team_id" | "club_id" | "group_id",
  select: string,
): InboxPrefetchJob[] {
  return ids.slice(0, cap).map((id) => ({
    queryKey: [`${queryKeyPrefix}-messages`, id],
    table,
    select,
    scope: { column: scopeColumn, value: id },
  }));
}

/**
 * Describes the inbox's bounded speculative reads. The page still owns when
 * these jobs run and how cancellation is handled.
 */
export function buildInboxPrefetchJobs(
  sources: InboxPrefetchSources,
): InboxPrefetchJob[] {
  return [
    {
      queryKey: ["broadcast-messages"],
      table: "broadcast_messages",
      select: "id, text, created_at, author_id, image_url, reply_to_id",
    },
    ...scopedJobs(
      sources.teamIds,
      sources.cap,
      "team_messages",
      "team",
      "team_id",
      "id, text, created_at, author_id, image_url, reply_to_id, team_id",
    ),
    ...scopedJobs(
      sources.clubIds,
      sources.cap,
      "club_messages",
      "club",
      "club_id",
      "id, text, created_at, author_id, image_url, reply_to_id, club_id",
    ),
    ...scopedJobs(
      sources.groupIds,
      sources.cap,
      "group_messages",
      "group",
      "group_id",
      "id, text, created_at, author_id, image_url, reply_to_id, group_id",
    ),
  ];
}
