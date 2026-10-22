import { describe, expect, it } from "vitest";
import { hideEmptyDefaultCopies } from "./hideEmptyDefaultCopies";
const g = (id: string, name: string, club = "giddy") => ({ id, name, club_id: club });
describe("hideEmptyDefaultCopies", () => {
  it("hides an empty duplicate Coaches chat but keeps the one with messages", () => {
    const r = hideEmptyDefaultCopies([g("old", "Coaches"), g("new", "Coaches")], (id) => id === "old");
    expect(r.map((x) => x.id)).toEqual(["old"]);
  });
  it("keeps both copies when both have messages", () => {
    expect(hideEmptyDefaultCopies([g("a", "Coaches"), g("b", "Coaches")], () => true)).toHaveLength(2);
  });
  it("keeps same-name chats in different clubs and non-default names", () => {
    const r = hideEmptyDefaultCopies([g("a", "Coaches"), g("b", "Coaches", "other"), g("c", "Fundraising"), g("d", "Fundraising")], () => false);
    expect(r).toHaveLength(4);
  });
});
