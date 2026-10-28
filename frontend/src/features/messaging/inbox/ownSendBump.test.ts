import { afterEach, describe, expect, it } from "vitest";
import {
  peekOwnSentConversationKeys,
  recordOwnSentConversation,
  resetOwnSentConversationBumpsForTests,
  subscribeOwnSentConversations,
} from "./ownSendBump";

describe("ownSendBump", () => {
  afterEach(() => resetOwnSentConversationBumpsForTests());

  it("returns recorded keys most-recently-sent first", () => {
    recordOwnSentConversation("team-a", 1000);
    recordOwnSentConversation("dm-b", 2000);
    expect(peekOwnSentConversationKeys(2000)).toEqual(["dm-b", "team-a"]);
  });

  it("re-sending to the same conversation moves it to the front without duplicating", () => {
    recordOwnSentConversation("team-a", 1000);
    recordOwnSentConversation("dm-b", 2000);
    recordOwnSentConversation("team-a", 3000);
    expect(peekOwnSentConversationKeys(3000)).toEqual(["team-a", "dm-b"]);
  });

  it("expires bumps after the TTL", () => {
    recordOwnSentConversation("team-a", 1000);
    expect(peekOwnSentConversationKeys(1000 + 11 * 60 * 1000)).toEqual([]);
  });

  it("bounds the number of remembered bumps", () => {
    for (let i = 0; i < 30; i += 1) recordOwnSentConversation(`team-${i}`, 1000 + i);
    expect(peekOwnSentConversationKeys(2000)).toHaveLength(20);
  });

  it("notifies subscribers on record and stops after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = subscribeOwnSentConversations(() => { calls += 1; });
    recordOwnSentConversation("team-a");
    expect(calls).toBe(1);
    unsubscribe();
    recordOwnSentConversation("team-b");
    expect(calls).toBe(1);
  });

  it("ignores empty keys", () => {
    recordOwnSentConversation("");
    expect(peekOwnSentConversationKeys()).toEqual([]);
  });
});
