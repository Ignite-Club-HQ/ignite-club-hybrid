import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { buildNewsShareToken } from "./newsShareToken";
import type { ClubNewsRow } from "./useClubNews";

const post: ClubNewsRow = {
  id: "post-1",
  club_id: "11111111-2222-3333-4444-555555555555",
  title: "Club update",
  content: "Body",
  author_id: "author",
  image_url: null,
  target_team_ids: null,
  is_important: false,
  published_at: new Date(1).toISOString(),
};

describe("buildNewsShareToken", () => {
  it("embeds the owning club as a routing hint when the post is cached", () => {
    const client = new QueryClient();
    client.setQueryData(["club-news-post", post.id], post);
    expect(buildNewsShareToken(client, post.id)).toBe(
      `[news:${post.club_id}:${post.id}]`,
    );
  });

  it("falls back to the plain token when the post is not cached", () => {
    const client = new QueryClient();
    expect(buildNewsShareToken(client, "post-1")).toBe("[news:post-1]");
  });

  it("falls back to the plain token when the cached row has no club", () => {
    const client = new QueryClient();
    client.setQueryData(["club-news-post", post.id], { ...post, club_id: "" });
    expect(buildNewsShareToken(client, post.id)).toBe("[news:post-1]");
  });
});
