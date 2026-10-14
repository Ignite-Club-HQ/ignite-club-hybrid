import { beforeEach, describe, expect, it, vi } from "vitest";

const { actor } = vi.hoisted(() => ({
  actor: {
    list_news_authorized: vi.fn(),
    create_news_post: vi.fn(),
  },
}));

vi.mock("../domains", () => ({
  connectLiveClubDomain: vi.fn(async () => ({ actor })),
}));

vi.mock("./vault", () => ({
  registerLivePiiText: vi.fn(),
}));

import { createLiveNewsPost, listLiveNews, listLiveNewsMulti } from "./club";

const ctx = { identity: {}, target: {} } as any;

beforeEach(() => {
  actor.list_news_authorized.mockReset();
  actor.list_news_authorized.mockResolvedValue({ Ok: [] });
  actor.create_news_post.mockReset();
  actor.create_news_post.mockResolvedValue({ Ok: { id: "news-1" } });
});

describe("live news audience authorization", () => {
  it("uses the server-authorized audience query for a single club", async () => {
    await expect(listLiveNews(ctx, "club-1")).resolves.toEqual([]);
    expect(actor.list_news_authorized).toHaveBeenCalledWith(["club-1"]);
  });

  it("uses the same dynamic authorization for a cross-club feed", async () => {
    await expect(listLiveNewsMulti(ctx, ["club-1", "club-2"])).resolves.toEqual([]);
    expect(actor.list_news_authorized).toHaveBeenCalledWith(["club-1", "club-2"]);
  });

  it("passes the competition audience in the generated Candid argument order", async () => {
    await createLiveNewsPost(ctx, "club-1", "Finals update", "Details", "published", {
      targetTeamIds: null,
      targetMiniLeagueId: null,
      targetCompetitionId: "competition-1",
      sendPush: true,
      isImportant: false,
      imageUrl: null,
      attachments: [],
    });

    expect(actor.create_news_post).toHaveBeenCalledWith(
      "club-1",
      "Finals update",
      "Details",
      "published",
      [],
      [],
      ["competition-1"],
      true,
      false,
      [],
      [],
    );
  });
});
