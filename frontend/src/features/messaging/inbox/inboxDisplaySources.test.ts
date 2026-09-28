import { describe, expect, it } from "vitest";
import { resolveInboxDisplayList } from "./inboxDisplaySources";

type Row = { id: string };
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

describe("resolveInboxDisplayList", () => {
  it("prefers a current non-empty sticky snapshot over stale cache", () => {
    const sticky = rows("current");
    expect(resolveInboxDisplayList({
      sticky,
      cached: rows("cached"),
      isOnline: true,
      isFetched: true,
    })).toBe(sticky);
  });

  it("uses the user-scoped cache before the first query settles", () => {
    expect(resolveInboxDisplayList({
      sticky: [],
      cached: rows("cached"),
      isOnline: true,
      isFetched: false,
    })).toEqual(rows("cached"));
  });

  it("uses cache while offline even when the remote result is empty", () => {
    expect(resolveInboxDisplayList({
      sticky: [],
      cached: rows("cached"),
      isOnline: false,
      isFetched: true,
    })).toEqual(rows("cached"));
  });

  it("honours a settled online empty list so deleted conversations cannot reappear", () => {
    const settledEmpty: Row[] = [];
    expect(resolveInboxDisplayList({
      sticky: settledEmpty,
      cached: rows("deleted"),
      isOnline: true,
      isFetched: true,
    })).toBe(settledEmpty);
  });

  it("falls back to cache when no sticky snapshot exists", () => {
    expect(resolveInboxDisplayList({
      sticky: undefined,
      cached: rows("cached"),
      isOnline: true,
      isFetched: true,
    })).toEqual(rows("cached"));
  });

  it("returns the same empty sticky identity when cache is absent", () => {
    const empty: Row[] = [];
    expect(resolveInboxDisplayList({
      sticky: empty,
      cached: undefined,
      isOnline: true,
      isFetched: true,
    })).toBe(empty);
  });

  it("returns an empty list when neither live nor cached rows exist", () => {
    expect(resolveInboxDisplayList<Row>({
      sticky: undefined,
      cached: undefined,
      isOnline: false,
      isFetched: false,
    })).toEqual([]);
  });
});
