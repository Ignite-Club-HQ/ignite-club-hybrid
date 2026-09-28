import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetReactionReconciliationRegistry,
  reconcileFlatReactions,
  recordRealtimeReaction,
  recordRealtimeReactionDelete,
  reconcileReactions,
  removeReactionFromMessages,
  upsertReactionInMessages,
} from "@/lib/chatReactionReconciliation";
import {
  _resetReconciliationRegistry,
  clearReconciliationScope,
  reconcileMessages,
} from "@/lib/chatMessageReconciliation";

type Msg = { id: string; text?: string; reactions?: { id: string; user_id: string; reaction_type: string }[] };

const msg = (id: string, reactions: Msg["reactions"] = []): Msg => ({ id, text: id, reactions });

const like = (id: string, user: string, type = "like") => ({ id, user_id: user, reaction_type: type });

beforeEach(() => {
  _resetReactionReconciliationRegistry();
  _resetReconciliationRegistry();
});

describe("pure reaction operations", () => {
  it("adds a reaction to the right message only", () => {
    const list = [msg("m1"), msg("m2")];
    const next = upsertReactionInMessages(list, "m1", like("r1", "u1"));
    expect(next[0].reactions).toEqual([like("r1", "u1")]);
    expect(next[1]).toBe(list[1]);
  });

  it("is idempotent for duplicate reaction INSERT deliveries", () => {
    const list = [msg("m1")];
    const once = upsertReactionInMessages(list, "m1", like("r1", "u1"));
    const twice = upsertReactionInMessages(once, "m1", like("r1", "u1"));
    expect(twice).toBe(once);
    expect(twice[0].reactions).toHaveLength(1);
  });

  it("replaces an optimistic temp reaction from the same user", () => {
    const list = [msg("m1", [like("temp-1", "u1")])];
    const next = upsertReactionInMessages(list, "m1", like("r1", "u1"));
    expect(next[0].reactions).toEqual([like("r1", "u1")]);
  });

  it("keeps distinct reactions from different users", () => {
    let list = [msg("m1")];
    list = upsertReactionInMessages(list, "m1", like("r1", "u1"));
    list = upsertReactionInMessages(list, "m1", like("r2", "u2", "love"));
    expect(list[0].reactions).toEqual([like("r1", "u1"), like("r2", "u2", "love")]);
  });

  it("applies a reaction UPDATE in place", () => {
    const list = [msg("m1", [like("r1", "u1")])];
    const next = upsertReactionInMessages(list, "m1", like("r1", "u1", "love"));
    expect(next[0].reactions).toEqual([like("r1", "u1", "love")]);
  });

  it("removes on DELETE and is idempotent", () => {
    const list = [msg("m1", [like("r1", "u1"), like("r2", "u2")])];
    const next = removeReactionFromMessages(list, "r1");
    expect(next[0].reactions).toEqual([like("r2", "u2")]);
    expect(removeReactionFromMessages(next, "r1")).toBe(next);
  });
});

describe("registry reconciliation", () => {
  it("re-applies a reaction when a stale query response lands afterwards", () => {
    recordRealtimeReaction("team:1", "m1", like("r1", "u1"));
    // Stale fetch result: message with no reactions at all.
    const stale = [msg("m1")];
    const reconciled = reconcileReactions("team:1", stale)!;
    expect(reconciled[0].reactions).toEqual([like("r1", "u1")]);
  });

  it("keeps a reaction that arrived before its message is loaded", () => {
    recordRealtimeReaction("team:1", "m9", like("r9", "u1"));
    expect(reconcileReactions("team:1", [msg("m1")])![0].reactions).toEqual([]);
    // Message finally arrives via the query -> reaction is applied.
    const withMsg = reconcileReactions("team:1", [msg("m1"), msg("m9")])!;
    expect(withMsg[1].reactions).toEqual([like("r9", "u1")]);
  });

  it("does not resurrect a deleted reaction (delete beats later upsert)", () => {
    recordRealtimeReactionDelete("team:1", "m1", "r1");
    recordRealtimeReaction("team:1", "m1", like("r1", "u1"));
    const reconciled = reconcileReactions("team:1", [msg("m1", [like("r1", "u1")])])!;
    expect(reconciled[0].reactions).toEqual([]);
  });

  it("handles DELETE payloads with no message id (scope-wide tombstone)", () => {
    recordRealtimeReactionDelete("team:1", null, "r1");
    const reconciled = reconcileReactions("team:1", [msg("m1", [like("r1", "u1")])])!;
    expect(reconciled[0].reactions).toEqual([]);
  });

  it("is scoped per chat", () => {
    recordRealtimeReaction("team:1", "m1", like("r1", "u1"));
    expect(reconcileReactions("team:2", [msg("m1")])![0].reactions).toEqual([]);
  });

  it("ignores temp reaction ids", () => {
    recordRealtimeReaction("team:1", "m1", like("temp-1", "u1"));
    expect(reconcileReactions("team:1", [msg("m1")])![0].reactions).toEqual([]);
  });

  it("is applied by the shared reconcileMessages path", () => {
    recordRealtimeReaction("club:1", "m1", like("r1", "u1"));
    const reconciled = reconcileMessages("club:1", [msg("m1")])!;
    expect((reconciled[0] as Msg).reactions).toEqual([like("r1", "u1")]);
  });

  it("is cleared with the message scope", () => {
    recordRealtimeReaction("club:1", "m1", like("r1", "u1"));
    clearReconciliationScope("club:1");
    expect(reconcileMessages("club:1", [msg("m1")])![0].reactions).toEqual([]);
  });
});

describe("flat reactions (group/operational chats)", () => {
  type Flat = { id: string; user_id: string; reaction_type: string; group_message_id: string };
  const build = (messageId: string, r: { id: string; user_id: string; reaction_type: string }): Flat => ({
    ...r,
    group_message_id: messageId,
  });

  it("re-adds a realtime reaction dropped by a stale response", () => {
    recordRealtimeReaction("group:1", "m1", like("r1", "u1"));
    const out = reconcileFlatReactions<Flat>("group:1", [], (r) => r.group_message_id, build);
    expect(out).toEqual([build("m1", like("r1", "u1"))]);
  });

  it("removes a deleted reaction re-introduced by a stale response", () => {
    recordRealtimeReactionDelete("group:1", "m1", "r1");
    const out = reconcileFlatReactions<Flat>(
      "group:1",
      [build("m1", like("r1", "u1")), build("m1", like("r2", "u2"))],
      (r) => r.group_message_id,
      build,
    );
    expect(out).toEqual([build("m1", like("r2", "u2"))]);
  });

  it("returns the same array when there is nothing to reconcile", () => {
    const flat = [build("m1", like("r1", "u1"))];
    expect(reconcileFlatReactions<Flat>("group:1", flat, (r) => r.group_message_id, build)).toBe(flat);
  });
});
