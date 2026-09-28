import { describe, expect, it } from "vitest";
import { splitPageWindow } from "./chatPageWindow";

describe("splitPageWindow", () => {
  it("reports no more pages when rows are within the page size", () => {
    const rows = [1, 2, 3];
    expect(splitPageWindow(rows, 30)).toEqual({ items: [1, 2, 3], hasMore: false });
  });

  it("reports no more pages when rows exactly equal the page size", () => {
    const rows = [1, 2, 3];
    expect(splitPageWindow(rows, 3)).toEqual({ items: [1, 2, 3], hasMore: false });
  });

  it("trims to the page size and reports more when one extra row is fetched", () => {
    const rows = [1, 2, 3, 4];
    expect(splitPageWindow(rows, 3)).toEqual({ items: [1, 2, 3], hasMore: true });
  });

  it("handles an empty fetch", () => {
    expect(splitPageWindow([], 30)).toEqual({ items: [], hasMore: false });
  });

  it("does not mutate the input array", () => {
    const rows = [1, 2, 3, 4];
    const original = [...rows];
    splitPageWindow(rows, 3);
    expect(rows).toEqual(original);
  });

  it("fails safe (no truncation, hasMore false) for a non-positive page size", () => {
    const rows = [1, 2, 3];
    expect(splitPageWindow(rows, 0)).toEqual({ items: [1, 2, 3], hasMore: false });
    expect(splitPageWindow(rows, -5)).toEqual({ items: [1, 2, 3], hasMore: false });
  });
});
