import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { KeptPageActivity } from "@/components/layout/KeptPageActivity";
import { reconcileVisibleList, useStableVisibleList } from "./useStableVisibleList";

type Row = { id: string; text: string };
const a = { id: "a", text: "old" }, b = { id: "b", text: "old" };
describe("stable visible placement", () => {
  it("updates content without reordering and appends new rows", () => {
    expect(reconcileVisibleList([{ ...b, text: "new" }, a, { id: "c", text: "added" }], [a, b], row => row.id))
      .toEqual([a, { ...b, text: "new" }, { id: "c", text: "added" }]);
  });
  it("removes missing rows rather than preserving access from placement", () => {
    expect(reconcileVisibleList([b], [a, b], row => row.id)).toEqual([b]);
  });
  it("keeps section placement while the fresh unread count changes", () => {
    const old = { id: "a", section: "recent", unread: 0 };
    const fresh = { id: "a", section: "unread", unread: 2 };
    expect(reconcileVisibleList([fresh], [old], row => row.id, (previous, next) => ({ ...next, section: previous.section })))
      .toEqual([{ id: "a", section: "recent", unread: 2 }]);
  });
  it("resets when hidden and scopes do not carry across club or account changes", () => {
    let active = true;
    const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter><KeptPageActivity.Provider value={active}>{children}</KeptPageActivity.Provider></MemoryRouter>;
    const { result, rerender } = renderHook(({ rows, scope }) => useStableVisibleList(rows, { enabled: true, scope, key: row => row.id }),
      { initialProps: { rows: [a, b], scope: "p1:club1" }, wrapper });
    rerender({ rows: [b, a], scope: "p1:club1" });
    expect(result.current.map(row => row.id)).toEqual(["a", "b"]);
    act(() => { active = false; });
    rerender({ rows: [b, a], scope: "p1:club1" });
    act(() => { active = true; });
    rerender({ rows: [b, a], scope: "p1:club1" });
    expect(result.current.map(row => row.id)).toEqual(["b", "a"]);
    rerender({ rows: [a, b], scope: "p2:club2" });
    expect(result.current.map(row => row.id)).toEqual(["a", "b"]);
  });
  it("leaves disabled Supabase ordering unchanged", () => {
    const { result, rerender } = renderHook(({ rows }) => useStableVisibleList(rows, { enabled: false, scope: "sb", key: row => row.id }),
      { initialProps: { rows: [a, b] }, wrapper: MemoryRouter });
    rerender({ rows: [b, a] });
    expect(result.current).toEqual([b, a]);
  });
});