import { describe, expect, it } from "vitest";
import { buildInboxPrefetchJobs } from "./inboxPrefetch";

describe("buildInboxPrefetchJobs", () => {
  it("keeps the broadcast job first and caps each scoped source independently", () => {
    expect(
      buildInboxPrefetchJobs({
        teamIds: ["team-a", "team-b"],
        clubIds: ["club-a"],
        groupIds: ["group-a", "group-b"],
        cap: 1,
      }),
    ).toEqual([
      {
        queryKey: ["broadcast-messages"],
        table: "broadcast_messages",
        select: "id, text, created_at, author_id, image_url, reply_to_id",
      },
      {
        queryKey: ["team-messages", "team-a"],
        table: "team_messages",
        select: "id, text, created_at, author_id, image_url, reply_to_id, team_id",
        scope: { column: "team_id", value: "team-a" },
      },
      {
        queryKey: ["club-messages", "club-a"],
        table: "club_messages",
        select: "id, text, created_at, author_id, image_url, reply_to_id, club_id",
        scope: { column: "club_id", value: "club-a" },
      },
      {
        queryKey: ["group-messages", "group-a"],
        table: "group_messages",
        select: "id, text, created_at, author_id, image_url, reply_to_id, group_id",
        scope: { column: "group_id", value: "group-a" },
      },
    ]);
  });

  it("does not mutate source arrays", () => {
    const teamIds = ["team-a", "team-b"];
    buildInboxPrefetchJobs({
      teamIds,
      clubIds: [],
      groupIds: [],
      cap: 1,
    });
    expect(teamIds).toEqual(["team-a", "team-b"]);
  });
});
