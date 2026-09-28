import { describe, it, expect } from "vitest";
import { performEventDeletion, resolveSeriesRootId } from "./eventSeriesDeletion";

/**
 * `delete().eq().select("id")` — the returned ids are the proof the intended
 * row was actually removed. A zero-row delete must never read as success.
 */
function makeSupabase(
  results: Array<{ data?: Array<{ id: string }> | null; error?: { message: string } | null }>,
) {
  const calls: Array<{ column: string; value: string }> = [];
  let i = 0;
  const supabase = {
    from: () => ({
      delete: () => ({
        eq: (column: string, value: string) => {
          calls.push({ column, value });
          const r = results[i++] ?? { data: [], error: null };
          return {
            select: () => Promise.resolve({ data: r.data ?? null, error: r.error ?? null }),
          };
        },
      }),
    }),
  } as any;
  return { supabase, calls };
}

describe("resolveSeriesRootId", () => {
  it("uses the event id for a recurring root", () => {
    expect(resolveSeriesRootId({ id: "root", is_recurring: true })).toBe("root");
  });
  it("uses parent_event_id for a recurring child", () => {
    expect(resolveSeriesRootId({ id: "child", parent_event_id: "root" })).toBe("root");
  });
});

describe("performEventDeletion", () => {
  it("deletes a single event exactly once and returns the deleted id", async () => {
    const { supabase, calls } = makeSupabase([{ data: [{ id: "e1" }] }]);
    const out = await performEventDeletion(supabase, { id: "e1" }, "single");
    expect(out).toEqual({ kind: "success", deletedIds: ["e1"] });
    expect(calls).toEqual([{ column: "id", value: "e1" }]);
  });

  it("does not touch siblings when 'this event only' is chosen on a recurring child", async () => {
    const { supabase, calls } = makeSupabase([{ data: [{ id: "child" }] }]);
    const out = await performEventDeletion(
      supabase,
      { id: "child", parent_event_id: "root" },
      "single",
    );
    expect(out.kind).toBe("success");
    expect(calls).toEqual([{ column: "id", value: "child" }]);
  });

  it("reports failure for a denied single delete", async () => {
    const { supabase } = makeSupabase([{ error: { message: "permission denied" } }]);
    const out = await performEventDeletion(supabase, { id: "e1" }, "single");
    expect(out).toEqual({ kind: "failed", message: "permission denied" });
  });

  it("treats a zero-row single delete as a failure, not silent success", async () => {
    const { supabase } = makeSupabase([{ data: [] }]);
    const out = await performEventDeletion(supabase, { id: "e1" }, "single");
    expect(out.kind).toBe("failed");
  });

  it("stops before the root delete when the child delete is denied", async () => {
    const { supabase, calls } = makeSupabase([{ error: { message: "denied" } }]);
    const out = await performEventDeletion(
      supabase,
      { id: "root", is_recurring: true },
      "series",
    );
    expect(out.kind).toBe("failed");
    expect(calls).toEqual([{ column: "parent_event_id", value: "root" }]);
  });

  it("reports a partial series when children commit but the root fails", async () => {
    const { supabase, calls } = makeSupabase([
      { data: [{ id: "c1" }] },
      { error: { message: "root denied" } },
    ]);
    const out = await performEventDeletion(
      supabase,
      { id: "child", parent_event_id: "root" },
      "series",
    );
    expect(out.kind).toBe("partial-series");
    expect(calls).toEqual([
      { column: "parent_event_id", value: "root" },
      { column: "id", value: "root" },
    ]);
  });

  it("reports a partial series when the root delete affects zero rows", async () => {
    const { supabase } = makeSupabase([{ data: [{ id: "c1" }] }, { data: [] }]);
    const out = await performEventDeletion(
      supabase,
      { id: "root", is_recurring: true },
      "series",
    );
    expect(out.kind).toBe("partial-series");
  });

  it("reports complete success only when both writes commit", async () => {
    const { supabase } = makeSupabase([
      { data: [{ id: "c1" }, { id: "c2" }] },
      { data: [{ id: "root" }] },
    ]);
    const out = await performEventDeletion(
      supabase,
      { id: "root", is_recurring: true },
      "series",
    );
    expect(out).toEqual({ kind: "success", deletedIds: ["c1", "c2", "root"] });
  });
});
