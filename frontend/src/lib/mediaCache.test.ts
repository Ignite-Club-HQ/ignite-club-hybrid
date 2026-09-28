import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { from, refreshResult, queries } = vi.hoisted(() => ({
  from: vi.fn(),
  refreshResult: { data: [] as any[] | null, error: null as any, throws: null as any },
  queries: [] as any[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import {
  addPhotoToCache,
  backgroundRefreshPhotos,
  cacheFolders,
  cachePhotos,
  clearMediaCache,
  clearMediaCacheForContext,
  getCachedFolders,
  getCachedPhotos,
  getFeedPhotosFromCache,
  removePhotoFromCache,
} from "./mediaCache";

function photosQuery() {
  if (refreshResult.throws) throw refreshResult.throws;
  const chain: any = {};
  for (const method of ["select", "eq", "order", "limit"]) chain[method] = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: any) => Promise.resolve(refreshResult).then(resolve),
  });
  queries.push(chain);
  return chain;
}

const photo = (id: string, overrides: Record<string, any> = {}) => ({
  id,
  file_url: `https://cdn.test/${id}.jpg`,
  title: `Photo ${id}`,
  caption: null,
  created_at: "2026-07-20T12:00:00.000Z",
  uploader_id: "user-1",
  team_id: "team-1",
  club_id: "club-1",
  folder_id: null,
  ...overrides,
});

describe("mediaCache isolation and expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
    clearMediaCache();
    localStorage.clear();
    vi.clearAllMocks();
    refreshResult.data = [];
    refreshResult.error = null;
    refreshResult.throws = null;
    queries.length = 0;
    from.mockImplementation(() => photosQuery());
  });

  afterEach(() => {
    clearMediaCache();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps photo caches isolated by team, club and folder", () => {
    cachePhotos("team-1", "club-1", "folder-1", [photo("photo-1", { folder_id: "folder-1" })]);
    cachePhotos("team-2", "club-1", "folder-1", [photo("photo-2", { team_id: "team-2", folder_id: "folder-1" })]);
    cachePhotos("team-1", "club-2", "folder-1", [photo("photo-3", { club_id: "club-2", folder_id: "folder-1" })]);
    cachePhotos("team-1", "club-1", "folder-2", [photo("photo-4", { folder_id: "folder-2" })]);

    expect(getCachedPhotos("team-1", "club-1", "folder-1").photos?.[0].id).toBe("photo-1");
    expect(getCachedPhotos("team-2", "club-1", "folder-1").photos?.[0].id).toBe("photo-2");
    expect(getCachedPhotos("team-1", "club-2", "folder-1").photos?.[0].id).toBe("photo-3");
    expect(getCachedPhotos("team-1", "club-1", "folder-2").photos?.[0].id).toBe("photo-4");
    expect(getCachedPhotos("team-9", "club-1", "folder-1")).toEqual({ photos: null, isStale: false });
  });

  it("keeps folder caches isolated by team and club", () => {
    cacheFolders("team-1", "club-1", [{ id: "folder-1", name: "Team files", team_id: "team-1" }]);
    cacheFolders("team-2", "club-1", [{ id: "folder-2", name: "Other files", team_id: "team-2" }]);

    expect(getCachedFolders("team-1", "club-1").folders?.[0].id).toBe("folder-1");
    expect(getCachedFolders("team-2", "club-1").folders?.[0].id).toBe("folder-2");
  });

  it("returns fresh photos before the 24-hour boundary", () => {
    cachePhotos("team-1", "club-1", null, [photo("photo-1")]);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);

    expect(getCachedPhotos("team-1", "club-1", null)).toEqual({
      photos: [expect.objectContaining({ id: "photo-1" })],
      isStale: false,
    });
  });

  it("marks photos stale from 24 to 48 hours and honours allowStale=false", () => {
    cachePhotos("team-1", "club-1", null, [photo("photo-1")]);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(getCachedPhotos("team-1", "club-1", null)).toEqual({
      photos: [expect.objectContaining({ id: "photo-1" })],
      isStale: true,
    });
    expect(getCachedPhotos("team-1", "club-1", null, { allowStale: false })).toEqual({
      photos: null,
      isStale: false,
    });
  });

  it("removes expired photos at the 48-hour boundary", () => {
    cachePhotos("team-1", "club-1", null, [photo("photo-1")]);
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);

    expect(getCachedPhotos("team-1", "club-1", null)).toEqual({ photos: null, isStale: false });
    expect(getCachedPhotos("team-1", "club-1", null)).toEqual({ photos: null, isStale: false });
  });

  it("applies the same freshness lifecycle to folders", () => {
    cacheFolders("team-1", "club-1", [{ id: "folder-1", name: "Files", team_id: "team-1" }]);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(getCachedFolders("team-1", "club-1").isStale).toBe(true);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(getCachedFolders("team-1", "club-1")).toEqual({ folders: null, isStale: false });
  });

  it("adds a new photo first and avoids growing a context beyond 200 entries", () => {
    cachePhotos("team-1", "club-1", null, Array.from({ length: 200 }, (_, i) => photo(`old-${i}`)));
    addPhotoToCache("team-1", "club-1", null, photo("new"));

    const cached = getCachedPhotos("team-1", "club-1", null).photos!;
    expect(cached).toHaveLength(200);
    expect(cached[0].id).toBe("new");
    expect(cached.some(item => item.id === "old-199")).toBe(false);
  });

  it("removes a photo identity from every cached context", () => {
    cachePhotos("team-1", "club-1", null, [photo("shared"), photo("keep-1")]);
    cachePhotos("team-2", "club-2", null, [photo("shared"), photo("keep-2")]);

    removePhotoFromCache("shared");

    expect(getCachedPhotos("team-1", "club-1", null).photos?.map(p => p.id)).toEqual(["keep-1"]);
    expect(getCachedPhotos("team-2", "club-2", null).photos?.map(p => p.id)).toEqual(["keep-2"]);
  });

  it("clears only the requested photo context", () => {
    cachePhotos("team-1", "club-1", "folder-1", [photo("photo-1")]);
    cachePhotos("team-1", "club-1", "folder-2", [photo("photo-2")]);

    clearMediaCacheForContext("team-1", "club-1", "folder-1");

    expect(getCachedPhotos("team-1", "club-1", "folder-1").photos).toBeNull();
    expect(getCachedPhotos("team-1", "club-1", "folder-2").photos?.[0].id).toBe("photo-2");
  });

  it("clears all in-memory and persisted media", async () => {
    cachePhotos(null, null, null, [photo("feed-photo")]);
    cacheFolders("team-1", "club-1", [{ id: "folder-1", name: "Files", team_id: "team-1" }]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(localStorage.getItem("ignite_photos_cache")).not.toBeNull();

    clearMediaCache();

    expect(getFeedPhotosFromCache().photos).toBeNull();
    expect(getCachedFolders("team-1", "club-1").folders).toBeNull();
    expect(localStorage.getItem("ignite_photos_cache")).toBeNull();
    expect(localStorage.getItem("ignite_folders_cache")).toBeNull();
  });

  it("background refresh applies every supplied scope and refresh limit", async () => {
    refreshResult.data = [photo("fresh", { folder_id: "folder-1" })];

    await expect(backgroundRefreshPhotos("team-1", "club-1", "folder-1", 25)).resolves.toEqual([
      expect.objectContaining({ id: "fresh", cached_at: Date.now() }),
    ]);

    expect(from).toHaveBeenCalledWith("photos");
    const query = queries[0];
    expect(query.eq).toHaveBeenCalledWith("show_in_feed", true);
    expect(query.eq).toHaveBeenCalledWith("team_id", "team-1");
    expect(query.eq).toHaveBeenCalledWith("club_id", "club-1");
    expect(query.eq).toHaveBeenCalledWith("folder_id", "folder-1");
    expect(query.limit).toHaveBeenCalledWith(25);
    expect(getCachedPhotos("team-1", "club-1", "folder-1").photos?.[0].id).toBe("fresh");
  });

  it("does not add absent scope filters to a feed refresh", async () => {
    refreshResult.data = [];
    await backgroundRefreshPhotos(null, null, null);

    expect(queries[0].eq).toHaveBeenCalledTimes(1);
    expect(queries[0].eq).toHaveBeenCalledWith("show_in_feed", true);
    expect(queries[0].limit).toHaveBeenCalledWith(50);
  });

  it.each(["query error", "exception"])("keeps existing cache when refresh ends in %s", async mode => {
    cachePhotos("team-1", "club-1", null, [photo("existing")]);
    if (mode === "query error") refreshResult.error = { message: "refresh denied" };
    else refreshResult.throws = new Error("adapter unavailable");

    await expect(backgroundRefreshPhotos("team-1", "club-1", null)).resolves.toBeNull();
    expect(getCachedPhotos("team-1", "club-1", null).photos?.[0].id).toBe("existing");
  });
});
