import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  resolveCommentNotificationTarget,
  resolvePhotoInteractionTarget,
  resolvePhotoPromptTarget,
  resolveUploadedPhotoTarget,
} from "./mediaNotificationRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Result = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

function scriptedClient(script: Record<string, Result[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq"]) {
      query[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return query;
      };
    }
    query.maybeSingle = async () => script[table]?.shift() ?? { data: null, error: null };
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, calls };
}

describe("media notification repository", () => {
  it.each([
    [false, "/media?photo=photo-a"],
    [true, "/media?photo=photo-a&comments=1"],
  ] as const)("opens an accessible photo with comments=%s", async (comments, path) => {
    const fake = scriptedClient({ photos: [{ data: { id: "photo-a", deleted_at: null }, error: null }] });
    await expect(resolvePhotoInteractionTarget("photo-a", comments, fake.client)).resolves.toEqual({ status: "found", path });
  });

  it.each([null, { id: "photo-a", deleted_at: "2026-08-18T00:00:00Z" }])(
    "does not open a missing or deleted photo: %s",
    async (data) => {
      const fake = scriptedClient({ photos: [{ data, error: null }] });
      await expect(resolvePhotoInteractionTarget("photo-a", false, fake.client)).resolves.toEqual({ status: "unavailable", path: null });
    },
  );

  it.each([
    [{ id: "photo-a", team_id: "team-a", club_id: "club-a", deleted_at: null }, "/media?team=team-a"],
    [{ id: "photo-a", team_id: null, club_id: "club-a", deleted_at: null }, "/media?club=club-a"],
    [{ id: "photo-a", team_id: null, club_id: null, deleted_at: null }, "/media"],
    [{ id: "photo-a", team_id: "team-a", club_id: null, deleted_at: "deleted" }, "/media"],
    [null, "/media"],
  ] as const)("routes an uploaded photo according to its current accessible scope", async (data, path) => {
    const fake = scriptedClient({ photos: [{ data, error: null }] });
    await expect(resolveUploadedPhotoTarget("photo-a", fake.client)).resolves.toBe(path);
  });

  it("opens the upload sheet scoped to the reminder event team", async () => {
    const fake = scriptedClient({ events: [{ data: { id: "event-a", team_id: "team-a" }, error: null }] });
    await expect(resolvePhotoPromptTarget("event-a", fake.client)).resolves.toBe("/media?team=team-a&event=event-a&upload=1");
  });

  it("opens the unscoped upload sheet when the reminder event is unavailable", async () => {
    await expect(resolvePhotoPromptTarget("event-a", scriptedClient({}).client)).resolves.toBe("/media?upload=1");
  });

  it("resolves a comment reaction through its photo and opens comments", async () => {
    const fake = scriptedClient({
      photo_comments: [{ data: { photo_id: "photo-a" }, error: null }],
      photos: [{ data: { id: "photo-a", deleted_at: null }, error: null }],
    });
    await expect(resolveCommentNotificationTarget("comment-a", false, fake.client)).resolves.toEqual({
      status: "found", path: "/media?photo=photo-a&comments=1",
    });
    expect(fake.calls).toContainEqual({ table: "photo_comments", method: "eq", args: ["id", "comment-a"] });
  });

  it("treats a comment reply related id as the photo id without querying comments", async () => {
    const fake = scriptedClient({ photos: [{ data: { id: "photo-a", deleted_at: null }, error: null }] });
    await expect(resolveCommentNotificationTarget("photo-a", true, fake.client)).resolves.toMatchObject({ status: "found" });
    expect(fake.calls.some((call) => call.table === "photo_comments")).toBe(false);
  });

  it("does not open an inaccessible comment or its deleted photo", async () => {
    const missingComment = scriptedClient({ photo_comments: [{ data: null, error: null }] });
    await expect(resolveCommentNotificationTarget("comment-a", false, missingComment.client)).resolves.toMatchObject({ status: "unavailable" });

    const deletedPhoto = scriptedClient({
      photo_comments: [{ data: { photo_id: "photo-a" }, error: null }],
      photos: [{ data: { id: "photo-a", deleted_at: "deleted" }, error: null }],
    });
    await expect(resolveCommentNotificationTarget("comment-a", false, deletedPhoto.client)).resolves.toMatchObject({ status: "unavailable" });
  });
});
