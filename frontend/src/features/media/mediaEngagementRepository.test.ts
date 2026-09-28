import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { createMediaComment, removeMediaReaction, replaceMediaReaction } from "./mediaEngagementRepository";

type Client = SupabaseClient<Database>;
type Result = { data: any; error: any };
type Call = { table: string; method: string; args: unknown[] };

function scriptedClient(script: Record<string, Result[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const result = script[table]?.shift() ?? { data: null, error: null };
    const query: Record<string, any> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    };
    for (const method of ["delete", "insert", "eq"]) query[method] = record(method);
    query.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as Client, calls };
}

describe("Media engagement repository", () => {
  it("replaces only the current user's reaction on the selected photo", async () => {
    const { client, calls } = scriptedClient({ photo_reactions: [
      { data: null, error: null }, { data: null, error: null },
    ] });
    await expect(replaceMediaReaction({
      photoId: "photo-a", userId: "user-a", reactionType: "love",
    }, client)).resolves.toBeUndefined();
    expect(calls).toEqual([
      { table: "photo_reactions", method: "delete", args: [] },
      { table: "photo_reactions", method: "eq", args: ["photo_id", "photo-a"] },
      { table: "photo_reactions", method: "eq", args: ["user_id", "user-a"] },
      { table: "photo_reactions", method: "insert", args: [{
        photo_id: "photo-a", user_id: "user-a", reaction_type: "love",
      }] },
    ]);
  });

  it("does not insert when removing the previous reaction fails", async () => {
    const failure = { message: "RLS denied", code: "42501" };
    const { client, calls } = scriptedClient({ photo_reactions: [{ data: null, error: failure }] });
    await expect(replaceMediaReaction({
      photoId: "photo-a", userId: "user-a", reactionType: "love",
    }, client)).rejects.toEqual(failure);
    expect(calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("surfaces replacement insert failures so optimistic UI can roll back", async () => {
    const failure = { message: "insert denied", code: "42501" };
    const { client } = scriptedClient({ photo_reactions: [
      { data: null, error: null }, { data: null, error: failure },
    ] });
    await expect(replaceMediaReaction({
      photoId: "photo-a", userId: "user-a", reactionType: "love",
    }, client)).rejects.toEqual(failure);
  });

  it("removes with photo and user scope and propagates failure", async () => {
    const failure = { message: "delete denied" };
    const { client, calls } = scriptedClient({ photo_reactions: [{ data: null, error: failure }] });
    await expect(removeMediaReaction({ photoId: "photo-a", userId: "user-a" }, client))
      .rejects.toEqual(failure);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "photo_reactions", method: "eq", args: ["photo_id", "photo-a"] },
      { table: "photo_reactions", method: "eq", args: ["user_id", "user-a"] },
    ]));
  });

  it("creates top-level and reply comments with explicit ownership", async () => {
    const { client, calls } = scriptedClient({ photo_comments: [
      { data: null, error: null }, { data: null, error: null },
    ] });
    await createMediaComment({ photoId: "photo-a", userId: "user-a", text: "Top" }, client);
    await createMediaComment({
      photoId: "photo-a", userId: "user-a", text: "Reply", replyToId: "comment-a",
    }, client);
    expect(calls.filter((call) => call.method === "insert")).toEqual([
      { table: "photo_comments", method: "insert", args: [{
        photo_id: "photo-a", user_id: "user-a", text: "Top", reply_to_id: null,
      }] },
      { table: "photo_comments", method: "insert", args: [{
        photo_id: "photo-a", user_id: "user-a", text: "Reply", reply_to_id: "comment-a",
      }] },
    ]);
  });

  it("propagates comment permission failures", async () => {
    const failure = { message: "comment denied", code: "42501" };
    const { client } = scriptedClient({ photo_comments: [{ data: null, error: failure }] });
    await expect(createMediaComment({
      photoId: "photo-a", userId: "user-a", text: "No access",
    }, client)).rejects.toEqual(failure);
  });
});
