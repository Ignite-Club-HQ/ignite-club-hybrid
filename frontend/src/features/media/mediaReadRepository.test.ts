import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchGalleryCardPhotoIds,
  fetchHighlightedMediaPhoto,
  fetchMediaComments,
  fetchMediaFeedPage,
  fetchMediaReactions,
} from "./mediaReadRepository";

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
  clubId: null, teamId: null, eventId: null, dateFrom: null, dateTo: null,
  cardId: null, cardPhotoIds: undefined,
};

describe("Media read repository", () => {
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
