import { describe, it, expect } from "vitest";
import { chatScopeFromPath, scopeForChat } from "./chatScope";

describe("chat scope", () => {
  it("each chat page maps to its club, team or conversation", () => {
    expect(chatScopeFromPath("/messages/club/c1")).toEqual({ clubId: "c1" });
    expect(chatScopeFromPath("/messages/t1")).toEqual({ teamId: "t1" });
    expect(chatScopeFromPath("/groups/g1")).toEqual({ conversationId: "g1" });
    expect(chatScopeFromPath("/messages/dm/d1")).toEqual({ conversationId: "d1" });
    expect(chatScopeFromPath("/messages/club-admin/a1")).toEqual({ conversationId: "a1" });
    expect(chatScopeFromPath("/messages/broadcast")).toEqual({ shared: "app" });
  });
  it("a page that is not a chat gives no scope (routing refuses instead of guessing)", () => {
    expect(chatScopeFromPath("/events/e1")).toBeUndefined();
    expect(chatScopeFromPath("/messages")).toBeUndefined();
  });
  it("chat kinds map the same way", () => {
    expect(scopeForChat("club", "c1")).toEqual({ clubId: "c1" });
    expect(scopeForChat("team", "t1")).toEqual({ teamId: "t1" });
    expect(scopeForChat("club_admin", "a1")).toEqual({ conversationId: "a1" });
    expect(scopeForChat("team", null)).toBeUndefined();
  });
});
