import { describe, expect, it } from "vitest";
import { buildChatComposerText, hasChatComposerContent } from "./chatComposerIntent";

describe("chat composer intent", () => {
  it.each([
    [{ text: "   " }, false],
    [{ text: " hello " }, true],
    [{ text: "", imageUrl: "https://cdn/photo.jpg" }, true],
    [{ text: "", pendingPollId: "poll-1" }, true],
  ] as const)("classifies sendable content %#", (content, expected) => {
    expect(hasChatComposerContent(content)).toBe(expected);
  });

  it.each([
    [" hello ", null, "hello"],
    [" question ", "poll-1", "question [poll:poll-1]"],
    ["   ", "poll-1", "[poll:poll-1]"],
  ])("builds the exact persisted text contract %#", (text, pollId, expected) => {
    expect(buildChatComposerText(text, pollId)).toBe(expected);
  });
});
