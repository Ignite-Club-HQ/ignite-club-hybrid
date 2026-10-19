import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchGalleryCardPhotoIds,
  fetchHighlightedMediaPhoto,
  fetchMediaComments,
  fetchMediaFeedPage,
  fetchMediaReactions,
} from "./mediaReadRepository";

const mediaReadMocks = vi.hoisted(() => ({
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  listAssets: vi.fn(),
  listComments: vi.fn(),
  listReactions: vi.fn(),
}));
const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";
const icpContext = { identity: {}, target: { alias: "test" } };

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mediaReadMocks.backend === "icp" ? providers.icp(icpContext) : providers.supabase(),
}));
vi.mock("@/live/features/media", () => ({
  listLiveAssets: (...args: unknown[]) => mediaReadMocks.listAssets(...args),
  listLiveComments: (...args: unknown[]) => mediaReadMocks.listComments(...args),
  listLiveReactions: (...args: unknown[]) => mediaReadMocks.listReactions(...args),
  liveAssetSource: (asset: { storage_path: string }) => ({ kind: "supabase", storagePath: asset.storage_path }),
}));

type Client = SupabaseClient<Database>;
type Result = { data: any; error: any };
type Call = { table: string; method: string; args: unknown[] };

function scriptedClient(script: Record<string, Result[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const query: Record<string, any> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    };
    for (const method of ["select", "eq", "is", "in", "gte", "lte", "order", "range"]) query[method] = record(method);
    const take = () => script[table]?.shift() ?? { data: null, error: null };
    query.maybeSingle = async () => take();
    query.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as Client, calls };
}

const noFilters = {
  clubId: null, teamId: null, eventId: null, competitionId: null, dateFrom: null, dateTo: null,
  cardId: null, cardPhotoIds: undefined,
};

describe.runIf(supabaseMode)("Media read repository — Supabase", () => {
  beforeEach(() => {
    mediaReadMocks.backend = "supabase";
  });

  it("reads and normalizes one gallery-card photo-id scope", async () => {
    const { client, calls } = scriptedClient({
      gallery_chat_cards: [{ data: { photo_ids: ["photo-a", "photo-b"] }, error: null }],
    });
    await expect(fetchGalleryCardPhotoIds("card-a", client)).resolves.toEqual(["photo-a", "photo-b"]);
    expect(calls).toContainEqual({ table: "gallery_chat_cards", method: "eq", args: ["id", "card-a"] });
  });

  it("applies every feed visibility and scope filter with exact pagination", async () => {
    const photos = Array.from({ length: 9 }, (_, index) => ({ id: `photo-${index}` }));
    const { client, calls } = scriptedClient({ photos: [{ data: photos, error: null }] });
    await expect(fetchMediaFeedPage({
      clubId: "club-a", teamId: "team-a", eventId: "event-a",
      competitionId: "competition-a",
      dateFrom: "from", dateTo: "to", cardId: "card-a", cardPhotoIds: ["photo-a"],
      offset: 9, pageSize: 9,
    }, client)).resolves.toEqual({ photos, nextCursor: 18 });
    expect(calls).toEqual(expect.arrayContaining([
      { table: "photos", method: "eq", args: ["show_in_feed", true] },
      { table: "photos", method: "is", args: ["deleted_at", null] },
      { table: "photos", method: "in", args: ["id", ["photo-a"]] },
      { table: "photos", method: "eq", args: ["club_id", "club-a"] },
      { table: "photos", method: "eq", args: ["team_id", "team-a"] },
      { table: "photos", method: "eq", args: ["event_id", "event-a"] },
      { table: "photos", method: "eq", args: ["competition_id", "competition-a"] },
      { table: "photos", method: "gte", args: ["created_at", "from"] },
      { table: "photos", method: "lte", args: ["created_at", "to"] },
      { table: "photos", method: "range", args: [9, 17] },
    ]));
  });

  it("short-circuits an empty gallery card and propagates feed denial", async () => {
    const emptyClient = scriptedClient({});
    await expect(fetchMediaFeedPage({
      ...noFilters, cardId: "card-a", cardPhotoIds: [], offset: 0, pageSize: 9,
    }, emptyClient.client)).resolves.toEqual({ photos: [], nextCursor: undefined });
    expect(emptyClient.calls).toEqual([]);

    const failure = { message: "RLS denied", code: "42501" };
    const deniedClient = scriptedClient({ photos: [{ data: null, error: failure }] });
    await expect(fetchMediaFeedPage({ ...noFilters, offset: 0, pageSize: 9 }, deniedClient.client))
      .rejects.toEqual(failure);
  });

  it("retries a highlighted photo with the established backoff and secure filters", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { client, calls } = scriptedClient({ photos: [
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "photo-a" }, error: null },
    ] });
    await expect(fetchHighlightedMediaPhoto("photo-a", client, sleep)).resolves.toEqual({ id: "photo-a" });
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "photos", method: "eq", args: ["id", "photo-a"] },
      { table: "photos", method: "eq", args: ["show_in_feed", true] },
      { table: "photos", method: "is", args: ["deleted_at", null] },
    ]));
  });

  it("keeps reaction and comment reads best-effort after backend errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = scriptedClient({
      photo_reactions: [{ data: null, error: { message: "reaction denied" } }],
      photo_comments: [{ data: null, error: { message: "comment denied" } }],
    });
    await expect(fetchMediaReactions(["photo-a"], client)).resolves.toEqual([]);
    await expect(fetchMediaComments(["photo-a"], client)).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it("does not query engagement tables without visible photo ids", async () => {
    const { client, calls } = scriptedClient({});
    await expect(fetchMediaReactions([], client)).resolves.toEqual([]);
    await expect(fetchMediaComments([], client)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe.runIf(!supabaseMode)("Media read repository — ICP", () => {
  beforeEach(() => {
    mediaReadMocks.backend = "icp";
    mediaReadMocks.listAssets.mockReset();
    mediaReadMocks.listComments.mockReset();
    mediaReadMocks.listReactions.mockReset();
  });

  it("maps a club-scoped canister asset page to the frontend photo shape", async () => {
    mediaReadMocks.listAssets.mockResolvedValue([{
      id: "asset-a",
      deleted: false,
      club_id: "club-a",
      storage_path: "clubs/club-a/photo-a",
      kind: "photo",
      owner: { toText: () => "principal-a" },
      competition_id: ["competition-a"],
    }]);
    const { client } = scriptedClient({});
    await expect(fetchMediaFeedPage({ ...noFilters, clubId: "club-a", offset: 0, pageSize: 9 }, client))
      .resolves.toMatchObject({
        photos: [{ id: "asset-a", club_id: "club-a", competition_id: "competition-a", uploader_id: "principal-a" }],
        nextCursor: undefined,
      });
    expect(mediaReadMocks.listAssets).toHaveBeenCalledWith(icpContext, "club-a");
  });

  it("maps ICP reaction and comment records to the shared display contract", async () => {
    mediaReadMocks.listReactions.mockResolvedValue([{
      asset_id: "photo-a",
      user: { toText: () => "principal-a" },
      kind: "love",
    }]);
    mediaReadMocks.listComments.mockResolvedValue([{
      id: "comment-a",
      asset_id: "photo-a",
      author: { toText: () => "principal-a" },
      body: "Nice photo",
      deleted: false,
      created_at_ms: 10n,
    }]);
    const { client, calls } = scriptedClient({});
    await expect(fetchMediaReactions(["photo-a"], client)).resolves.toEqual([
      { photo_id: "photo-a", user_id: "principal-a", reaction_type: "love", profiles: null },
    ]);
    await expect(fetchMediaComments(["photo-a"], client)).resolves.toEqual([
      expect.objectContaining({ id: "comment-a", text: "Nice photo", reply_to_id: null, user_id: "principal-a" }),
    ]);
    expect(calls).toEqual([]);
  });

  it("short-circuits empty gallery-card scopes without querying the canister", async () => {
    const { client, calls } = scriptedClient({});
    await expect(fetchMediaFeedPage({ ...noFilters, cardId: "card-a", cardPhotoIds: [], offset: 0, pageSize: 9 }, client))
      .resolves.toEqual({ photos: [], nextCursor: undefined });
    expect(mediaReadMocks.listAssets).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
