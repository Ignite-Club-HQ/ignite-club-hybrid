import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ─── Supabase mock ─────────────────────────────────────────────────────────
// Fluent builder that resolves on `.maybeSingle()` / `.single()` with values
// programmed per test via the shared handler refs below.

type LookupResult = { data: { id: string } | null; error: { message: string } | null };
type InsertResult = { data: { id: string } | null; error: { message: string } | null };

const state: {
  lookup: LookupResult;
  insert: InsertResult;
  uploadError: { message: string } | null;
  updateError: { message: string } | null;
  removed: string[][];
  uploaded: Array<{ path: string; blob: Blob; opts: any }>;
  insertPayload: any;
} = {
  lookup: { data: null, error: null },
  insert: { data: { id: "new-photo" }, error: null },
  uploadError: null,
  updateError: null,
  removed: [],
  uploaded: [],
  insertPayload: null,
};

function makeSelectBuilder(finalResult: LookupResult) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    maybeSingle: () => Promise.resolve(finalResult),
    single: () => Promise.resolve(finalResult),
  };
  return builder;
}

function makeInsertBuilder(finalResult: InsertResult) {
  const builder: any = {
    select: () => builder,
    single: () => Promise.resolve(finalResult),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: (_table: string) => ({
        select: (..._args: any[]) => makeSelectBuilder(state.lookup).select(),
        insert: (payload: any) => {
          state.insertPayload = payload;
          return makeInsertBuilder(state.insert);
        },
        update: (_payload: any) => ({
          eq: () => Promise.resolve({ error: state.updateError }),
        }),
      }),
      storage: {
        from: (_bucket: string) => ({
          upload: (path: string, blob: Blob, opts: any) => {
            state.uploaded.push({ path, blob, opts });
            return Promise.resolve({ error: state.uploadError });
          },
          remove: (paths: string[]) => {
            state.removed.push(paths);
            return Promise.resolve({ error: null });
          },
        }),
      },
    },
  };
});

// Import AFTER mock is registered.
import {
  publishChatImageToGallery,
  unpublishGalleryPhoto,
} from "./publishChatImageToGallery";

const originalFetch = globalThis.fetch;

function stubFetch(blob: Blob, ok = true, status = 200) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    blob: async () => blob,
  })) as any;
}

beforeEach(() => {
  state.lookup = { data: null, error: null };
  state.insert = { data: { id: "new-photo" }, error: null };
  state.uploadError = null;
  state.updateError = null;
  state.removed = [];
  state.uploaded = [];
  state.insertPayload = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const IMG = "https://reference.invalid";

describe("publishChatImageToGallery", () => {
  it("rejects when imageUrl missing", async () => {
    await expect(
      publishChatImageToGallery({ imageUrl: "", uploaderId: "u1", teamId: "t1", clubId: "c1" }),
    ).rejects.toThrow(/imageUrl/);
  });

  it("rejects when uploaderId missing", async () => {
    await expect(
      publishChatImageToGallery({ imageUrl: IMG, uploaderId: "", teamId: "t1", clubId: "c1" }),
    ).rejects.toThrow(/uploaderId/);
  });

  it("rejects when neither teamId nor clubId provided", async () => {
    await expect(
      publishChatImageToGallery({ imageUrl: IMG, uploaderId: "u1", teamId: null, clubId: null }),
    ).rejects.toThrow(/teamId or clubId/);
  });

  it("returns alreadyPublished without downloading when a row exists", async () => {
    state.lookup = { data: { id: "existing-id" }, error: null };
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const result = await publishChatImageToGallery({
      imageUrl: IMG,
      uploaderId: "u1",
      teamId: "t1",
      clubId: "c1",
    });

    expect(result).toEqual({ photoId: "existing-id", alreadyPublished: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.uploaded).toHaveLength(0);
    expect(state.insertPayload).toBeNull();
  });

  it("must stop before copying media when the idempotency lookup fails", async () => {
    state.lookup = { data: null, error: { message: "permission denied" } };
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    await expect(
      publishChatImageToGallery({
        imageUrl: IMG,
        uploaderId: "u1",
        teamId: "t1",
        clubId: "c1",
      }),
    ).rejects.toThrow(/permission denied/);

    // No fetch, no storage upload, no photos insert.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.uploaded).toHaveLength(0);
    expect(state.insertPayload).toBeNull();
  });

  it("uses a fallback error message when the lookup error has none", async () => {
    state.lookup = { data: null, error: { message: "" } };
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    await expect(
      publishChatImageToGallery({
        imageUrl: IMG,
        uploaderId: "u1",
        teamId: "t1",
        clubId: "c1",
      }),
    ).rejects.toThrow(/already published/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.uploaded).toHaveLength(0);
  });

  it("throws a friendly error when the source image cannot be downloaded", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 })) as any;

    await expect(
      publishChatImageToGallery({
        imageUrl: IMG,
        uploaderId: "u1",
        teamId: "t1",
        clubId: "c1",
      }),
    ).rejects.toThrow(/load the image/);
    expect(state.uploaded).toHaveLength(0);
    expect(state.insertPayload).toBeNull();
  });

  it("uploads to clubs/{clubId}/teams/{teamId}/{uploaderId}/... when both are supplied and inserts scoped row", async () => {
    stubFetch(new Blob(["hi"], { type: "image/jpeg" }));

    const result = await publishChatImageToGallery({
      imageUrl: IMG,
      uploaderId: "u1",
      teamId: "t1",
      clubId: "c1",
      caption: "hello",
      albumId: "album-1",
    });

    expect(result.alreadyPublished).toBe(false);
    expect(state.uploaded).toHaveLength(1);
    const { path, opts } = state.uploaded[0];
    expect(path.startsWith("clubs/c1/teams/t1/u1/")).toBe(true);
    expect(path.endsWith(".jpg")).toBe(true);
    expect(opts.upsert).toBe(false);
    expect(state.insertPayload).toMatchObject({
      uploader_id: "u1",
      club_id: "c1",
      team_id: "t1",
      caption: "hello",
      title: "hello",
      album_id: "album-1",
    });
  });

  it("uploads to teams/{teamId}/... when only teamId is provided", async () => {
    stubFetch(new Blob(["hi"], { type: "image/png" }));

    await publishChatImageToGallery({
      imageUrl: IMG,
      uploaderId: "u1",
      teamId: "t1",
      clubId: null,
    });

    expect(state.uploaded[0].path.startsWith("teams/t1/u1/")).toBe(true);
    expect(state.uploaded[0].path.endsWith(".png")).toBe(true);
  });

  it("uploads to clubs/{clubId}/{uploaderId}/... for club-wide chats", async () => {
    stubFetch(new Blob(["hi"], { type: "image/webp" }));

    await publishChatImageToGallery({
      imageUrl: IMG,
      uploaderId: "u1",
      teamId: null,
      clubId: "c1",
    });

    expect(state.uploaded[0].path.startsWith("clubs/c1/u1/")).toBe(true);
    expect(state.uploaded[0].path.endsWith(".webp")).toBe(true);
  });

  it("cleans up storage when the photos insert fails", async () => {
    stubFetch(new Blob(["hi"], { type: "image/jpeg" }));
    state.insert = { data: null, error: { message: "rls denied" } };

    await expect(
      publishChatImageToGallery({
        imageUrl: IMG,
        uploaderId: "u1",
        teamId: "t1",
        clubId: "c1",
      }),
    ).rejects.toMatchObject({ message: "rls denied" });

    expect(state.removed).toHaveLength(1);
    expect(state.removed[0][0]).toBe(state.uploaded[0].path);
  });

  it("unpublishGalleryPhoto soft-deletes the given photo and surfaces errors", async () => {
    await expect(unpublishGalleryPhoto("photo-1")).resolves.toBeUndefined();

    state.updateError = { message: "boom" };
    await expect(unpublishGalleryPhoto("photo-2")).rejects.toThrow(/undo/);
  });
});
