import { describe, expect, it } from "vitest";
import { resolveStickyList } from "@/hooks/useStickyList";

type Row = { id: string };
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

describe("sticky inbox lists (resume stability)", () => {
  it("passes through a non-empty result and retains it", () => {
    const r = resolveStickyList(rows("a", "b"), null, { isFetched: true });
    expect(r.value.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.retained).toBe(r.value);
  });

  it("keeps the last non-empty list when the query goes undefined mid-refetch", () => {
    const first = resolveStickyList(rows("a"), null, { isFetched: true });
    const resume = resolveStickyList<Row>(undefined, first.retained, { isFetching: true, isFetched: true });
    expect(resume.value.map((x) => x.id)).toEqual(["a"]);
  });

  it("keeps the last non-empty list when a refetch transiently returns []", () => {
    const first = resolveStickyList(rows("a"), null, { isFetched: true });
    const resume = resolveStickyList<Row>([], first.retained, { isFetching: true, isFetched: true });
    expect(resume.value.map((x) => x.id)).toEqual(["a"]);
  });

  it("keeps the last non-empty list when the query errors", () => {
    const first = resolveStickyList(rows("a"), null, { isFetched: true });
    const errored = resolveStickyList<Row>([], first.retained, { isError: true, isFetched: true });
    expect(errored.value.map((x) => x.id)).toEqual(["a"]);
  });

  it("keeps the last non-empty list before the query has ever settled", () => {
    const first = resolveStickyList(rows("a"), null, { isFetched: true });
    const pending = resolveStickyList<Row>([], first.retained, { isFetched: false });
    expect(pending.value.map((x) => x.id)).toEqual(["a"]);
  });

  it("honours a settled empty result (removed conversations do not linger)", () => {
    const first = resolveStickyList(rows("a"), null, { isFetched: true });
    const settled = resolveStickyList<Row>([], first.retained, {
      isFetching: false,
      isFetched: true,
      isError: false,
    });
    expect(settled.value).toEqual([]);
    expect(settled.retained).toBeNull();
  });

  it("does not resurrect rows after a settled empty result", () => {
    const settled = resolveStickyList<Row>([], rows("a"), { isFetched: true });
    const next = resolveStickyList<Row>(undefined, settled.retained, { isFetching: true, isFetched: true });
    expect(next.value).toEqual([]);
  });

  it("adopts a newer non-empty list over the retained one", () => {
    const first = resolveStickyList(rows("a"), null, { isFetched: true });
    const second = resolveStickyList(rows("b", "c"), first.retained, { isFetched: true });
    expect(second.value.map((x) => x.id)).toEqual(["b", "c"]);
    expect(second.retained?.map((x) => x.id)).toEqual(["b", "c"]);
  });
});
