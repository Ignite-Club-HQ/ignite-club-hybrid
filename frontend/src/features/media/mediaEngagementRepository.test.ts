import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { createMediaComment, removeMediaReaction, replaceMediaReaction } from "./mediaEngagementRepository";

const mediaMocks = vi.hoisted(() => ({
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  addReaction: vi.fn(),
  listReactions: vi.fn(),
  removeReaction: vi.fn(),
  addComment: vi.fn(),
}));

const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";
const icpContext = {
  identity: { getPrincipal: () => ({ toText: () => "principal-a" }) },
  target: { alias: "test" },
};

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mediaMocks.backend === "icp" ? providers.icp(icpContext) : providers.supabase(),
}));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => false }));
vi.mock("@/live/features/media", () => ({
  addLiveReaction: (...args: unknown[]) => mediaMocks.addReaction(...args),
  listLiveReactions: (...args: unknown[]) => mediaMocks.listReactions(...args),
  removeLiveReaction: (...args: unknown[]) => mediaMocks.removeReaction(...args),
  addLiveComment: (...args: unknown[]) => mediaMocks.addComment(...args),
}));

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

describe.runIf(supabaseMode)("Media engagement repository — Supabase", () => {
  beforeEach(() => {
    mediaMocks.backend = "supabase";
  });

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

describe.runIf(!supabaseMode)("Media engagement repository — ICP", () => {
  beforeEach(() => {
    mediaMocks.backend = "icp";
    mediaMocks.addReaction.mockReset();
    mediaMocks.listReactions.mockReset();
    mediaMocks.removeReaction.mockReset();
    mediaMocks.addComment.mockReset();
  });

  it("replaces a reaction through the ICP media adapter", async () => {
    const { client, calls } = scriptedClient({});
    await replaceMediaReaction({ photoId: "photo-a", userId: "principal-a", reactionType: "love" }, client);
    expect(mediaMocks.addReaction).toHaveBeenCalledWith(icpContext, "photo-a", "love", expect.any(Number));
    expect(calls).toEqual([]);
  });

  it("removes only the caller's ICP reaction", async () => {
    mediaMocks.listReactions.mockResolvedValue([
      { id: "reaction-a", user: { toText: () => "principal-a" } },
      { id: "reaction-b", user: { toText: () => "principal-b" } },
    ]);
    const { client, calls } = scriptedClient({});
    await removeMediaReaction({ photoId: "photo-a", userId: "principal-a" }, client);
    expect(mediaMocks.listReactions).toHaveBeenCalledWith(icpContext, "photo-a");
    expect(mediaMocks.removeReaction).toHaveBeenCalledWith(icpContext, "reaction-a");
    expect(calls).toEqual([]);
  });

  it("creates an ICP comment without writing to Supabase", async () => {
    const { client, calls } = scriptedClient({});
    await createMediaComment({ photoId: "photo-a", userId: "principal-a", text: "Hello", replyToId: "comment-parent" }, client);
    expect(mediaMocks.addComment).toHaveBeenCalledWith(icpContext, "photo-a", "Hello", expect.any(Number));
    expect(calls).toEqual([]);
  });

  it("propagates ICP reaction and comment write denials without Supabase fallback", async () => {
    const denied = new Error("media engagement denied");
    mediaMocks.addReaction.mockRejectedValueOnce(denied);
    mediaMocks.addComment.mockRejectedValueOnce(denied);
    const { client, calls } = scriptedClient({});

    await expect(replaceMediaReaction({ photoId: "photo-a", userId: "principal-a", reactionType: "love" }, client))
      .rejects.toBe(denied);
    await expect(createMediaComment({ photoId: "photo-a", userId: "principal-a", text: "Denied" }, client))
      .rejects.toBe(denied);

    expect(calls).toEqual([]);
  });
});
