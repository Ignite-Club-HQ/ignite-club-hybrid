import { describe, expect, it, vi } from "vitest";
import { cacheMessages } from "@/lib/messageCache";
import {
  belongsToTeamChatThread,
  formatTeamChatMessageDate,
  getCachedTeamChatMessages,
} from "./teamChatMessageHelpers";

describe("formatTeamChatMessageDate", () => {
  it("formats today's messages as a bare time", () => {
    const now = new Date();
    expect(formatTeamChatMessageDate(now.toISOString())).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it("formats yesterday's messages with a Yesterday prefix", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatTeamChatMessageDate(yesterday.toISOString())).toMatch(/^Yesterday \d{1,2}:\d{2} (AM|PM)$/);
  });

  it("formats older messages with a month/day prefix", () => {
    expect(formatTeamChatMessageDate("2020-01-15T10:30:00.000Z")).toMatch(/^Jan 1[45], \d{1,2}:\d{2} (AM|PM)$/);
  });
});

describe("belongsToTeamChatThread", () => {
  it("returns false when there is no teamId", () => {
    expect(belongsToTeamChatThread({ team_id: "team-1" }, undefined)).toBe(false);
  });

  it("returns true for a message with a matching team_id", () => {
    expect(belongsToTeamChatThread({ team_id: "team-1" }, "team-1")).toBe(true);
  });

  it("returns false for a message from a different team", () => {
    expect(belongsToTeamChatThread({ team_id: "team-2" }, "team-1")).toBe(false);
  });

  it("returns true for optimistic/legacy rows with no team_id", () => {
    expect(belongsToTeamChatThread({ team_id: undefined }, "team-1")).toBe(true);
  });
});

describe("getCachedTeamChatMessages", () => {
  it("returns an empty array when there is nothing cached", () => {
    expect(getCachedTeamChatMessages("team-empty")).toEqual([]);
  });

  it("maps cached rows to the team message shape, defaulting team_id to the requested thread", () => {
    cacheMessages("team", "team-1", [
      {
        id: "m1",
        text: "hi",
        author_id: "user-1",
        created_at: "2024-01-01T00:00:00.000Z",
        image_url: null,
        reply_to_id: null,
        profiles: { display_name: "Jo", avatar_url: null },
        reactions: [{ reaction_type: "like", user_id: "user-2" }],
      },
    ]);

    const result = getCachedTeamChatMessages("team-1");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "m1",
      team_id: "team-1",
      text: "hi",
      reactions: [{ user_id: "user-2", reaction_type: "like" }],
    });
    expect(result[0].reactions[0].id).toMatch(/^cached-m1-user-2-like$/);
  });

  it("filters out cached rows carrying a foreign team_id (cross-team cache bleed guard)", () => {
    cacheMessages("team", "team-2", [
      {
        id: "m2",
        text: "from another team",
        author_id: "user-1",
        created_at: "2024-01-01T00:00:00.000Z",
        image_url: null,
        reply_to_id: null,
        profiles: null,
        team_id: "team-other",
      } as any,
    ]);

    expect(getCachedTeamChatMessages("team-2")).toEqual([]);
  });

  it("derives reply_to.profiles from a legacy author field when profiles is absent", () => {
    cacheMessages("team", "team-3", [
      {
        id: "m3",
        text: "reply",
        author_id: "user-1",
        created_at: "2024-01-01T00:00:00.000Z",
        image_url: null,
        reply_to_id: "m0",
        profiles: null,
        reply_to: { text: "original", author: { display_name: "Sam" } },
      },
    ]);

    const [result] = getCachedTeamChatMessages("team-3");
    expect(result.reply_to).toEqual({ text: "original", profiles: { display_name: "Sam" } });
  });
});
