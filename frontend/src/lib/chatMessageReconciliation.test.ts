import { describe, it, expect, beforeEach } from "vitest";
import {
  applyMessageUpdateToQueryEnvelope,
  applyMessageUpdate,
  removeMessage,
  removeMessageFromQueryEnvelope,
  recordRealtimeMutation,
  reconcileMessages,
  isTombstoned,
  clearReconciliationScope,
  _resetReconciliationRegistry,
} from "./chatMessageReconciliation";

type Msg = {
  id: string;
  text: string | null;
  image_url?: string | null;
  is_club_announcement?: boolean;
  club_announcement_name?: string | null;
  created_at: string;
  profiles?: { display_name: string } | null;
  reactions?: { id: string }[];
};

const base = (): Msg[] => [
  { id: "a", text: "one", created_at: "2026-01-01T00:00:00Z", profiles: { display_name: "A" }, reactions: [{ id: "r1" }] },
  { id: "b", text: "two", created_at: "2026-01-01T00:01:00Z", profiles: { display_name: "B" }, reactions: [] },
];

const SCOPE = "team:t1";

describe("chatMessageReconciliation", () => {
  beforeEach(() => _resetReconciliationRegistry());

  it("applyMessageUpdate updates only the target row and preserves absent fields", () => {
    const next = applyMessageUpdate(base(), { id: "a", text: "edited" });
    expect(next[0].text).toBe("edited");
    expect(next[0].profiles?.display_name).toBe("A");
    expect(next[0].reactions).toHaveLength(1);
    expect(next[1]).toEqual(base()[1]);
    expect(next).toHaveLength(2);
  });

  it("applyMessageUpdate is idempotent (same reference when nothing changes)", () => {
    const list = base();
    const once = applyMessageUpdate(list, { id: "a", text: "edited" });
    const twice = applyMessageUpdate(once, { id: "a", text: "edited" });
    expect(twice).toBe(once);
    expect(applyMessageUpdate(list, { id: "missing", text: "x" })).toBe(list);
  });

  it("removeMessage removes exactly one row and is idempotent", () => {
    const list = base();
    const next = removeMessage(list, "a");
    expect(next.map((m) => m.id)).toEqual(["b"]);
    expect(removeMessage(next, "a")).toBe(next);
  });

  it("a stale fetch cannot restore pre-edit text", () => {
    recordRealtimeMutation(SCOPE, { id: "a", text: "edited", updated_at: "2026-01-01T00:05:00Z" });
    const staleFetch = base(); // still says "one"
    const reconciled = reconcileMessages(SCOPE, staleFetch)!;
    expect(reconciled.find((m) => m.id === "a")!.text).toBe("edited");
  });

  it("a stale fetch cannot resurrect a soft-deleted message", () => {
    const outcome = recordRealtimeMutation(SCOPE, { id: "b", deleted_at: "2026-01-01T00:05:00Z" });
    expect(outcome).toBe("deleted");
    expect(isTombstoned(SCOPE, "b")).toBe(true);
    const reconciled = reconcileMessages(SCOPE, base())!;
    expect(reconciled.map((m) => m.id)).toEqual(["a"]);
  });

  it("a later edit event cannot undo a tombstone", () => {
    recordRealtimeMutation(SCOPE, { id: "b", deleted_at: "2026-01-01T00:05:00Z" });
    recordRealtimeMutation(SCOPE, { id: "b", text: "late edit" });
    expect(isTombstoned(SCOPE, "b")).toBe(true);
    expect(reconcileMessages(SCOPE, base())!.map((m) => m.id)).toEqual(["a"]);
  });

  it("out-of-order edits resolve by server timestamp, not receipt order", () => {
    recordRealtimeMutation(SCOPE, { id: "a", text: "newer", updated_at: "2026-01-01T00:10:00Z" });
    recordRealtimeMutation(SCOPE, { id: "a", text: "older", updated_at: "2026-01-01T00:02:00Z" });
    expect(reconcileMessages(SCOPE, base())![0].text).toBe("newer");
  });

  it("duplicate UPDATE delivery is idempotent and leaves unrelated rows untouched", () => {
    recordRealtimeMutation(SCOPE, { id: "a", text: "edited", updated_at: "2026-01-01T00:05:00Z" });
    recordRealtimeMutation(SCOPE, { id: "a", text: "edited", updated_at: "2026-01-01T00:05:00Z" });
    const list = base();
    const reconciled = reconcileMessages(SCOPE, list)!;
    expect(reconciled).toHaveLength(2);
    expect(reconciled[1]).toBe(list[1]);
    expect(reconcileMessages(SCOPE, reconciled)).toBe(reconciled);
  });

  it("reconcileMessages preserves order and returns the same array when no entries apply", () => {
    const list = base();
    expect(reconcileMessages(SCOPE, list)).toBe(list);
    recordRealtimeMutation("team:other", { id: "a", text: "x" });
    expect(reconcileMessages(SCOPE, list)).toBe(list);
  });

  it("clearReconciliationScope drops only that scope", () => {
    recordRealtimeMutation(SCOPE, { id: "a", deleted_at: "2026-01-01T00:05:00Z" });
    recordRealtimeMutation("team:t2", { id: "a", deleted_at: "2026-01-01T00:05:00Z" });
    clearReconciliationScope(SCOPE);
    expect(isTombstoned(SCOPE, "a")).toBe(false);
    expect(isTombstoned("team:t2", "a")).toBe(true);
  });

  it("image edits and announcement metadata are reconciled", () => {
    recordRealtimeMutation(SCOPE, {
      id: "a",
      image_url: "https://reference.invalid",
      is_club_announcement: true,
      club_announcement_name: "Riverside FC",
    });
    const [a] = reconcileMessages(SCOPE, base()) as any[];
    expect(a.image_url).toBe("https://reference.invalid");
    expect(a.is_club_announcement).toBe(true);
    expect(a.club_announcement_name).toBe("Riverside FC");
    expect(a.text).toBe("one");
  });
});

describe("chat query envelope reconciliation", () => {
  it("removes a message while preserving query metadata", () => {
    const result = removeMessageFromQueryEnvelope(
      { messages: base(), hasOlderMessages: true, fromCache: true },
      "a",
    );

    expect(result.messages.map((message) => message.id)).toEqual(["b"]);
    expect(result.hasOlderMessages).toBe(true);
    expect(result.fromCache).toBe(true);
  });

  it("applies a partial update while preserving enrichment and query metadata", () => {
    const result = applyMessageUpdateToQueryEnvelope(
      { messages: base(), hasOlderMessages: false },
      { id: "a", text: "edited" },
    );

    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        id: "a",
        text: "edited",
        profiles: { display_name: "A" },
        reactions: [{ id: "r1" }],
      }),
    );
    expect(result.hasOlderMessages).toBe(false);
  });

  it("creates the same empty envelope shape when query data is absent", () => {
    expect(removeMessageFromQueryEnvelope<Msg>(undefined, "missing")).toEqual({ messages: [] });
    expect(
      applyMessageUpdateToQueryEnvelope<Msg>(undefined, { id: "missing", text: "edited" }),
    ).toEqual({ messages: [] });
  });
});
