import { describe, expect, it } from "vitest";
import { POLL_TOKEN_PATTERN } from "./chatPollToken";

describe("poll attachment IDs", () => {
  it.each([
    "c1f2ed52-fda3-45b4-84d3-57fc253116e",
    "poll-chat-c1f2ed52-fda3-45b4-84d3-57fc253116e-20-1",
  ])("preserves the complete backend ID %s", (id) => {
    const match = new RegExp(POLL_TOKEN_PATTERN, "i").exec(`[poll:${id}]`);
    expect(match?.[1]).toBe(id);
  });

  it("extracts multiple attachments without swallowing their caption", () => {
    const text = "Choose [poll:poll-chat-one-1] or [poll:poll-chat-two-2]";
    const matches = [...text.matchAll(new RegExp(POLL_TOKEN_PATTERN, "gi"))];
    expect(matches.map((match) => match[1])).toEqual(["poll-chat-one-1", "poll-chat-two-2"]);
    expect(text.replace(new RegExp(POLL_TOKEN_PATTERN, "gi"), "")).toBe("Choose  or ");
  });

  it.each(["[poll:]", "[poll:bad id]", "[poll:unclosed", "[news:poll-chat-one-1]"])(
    "rejects malformed or non-poll attachments %s", (token) => {
      expect(new RegExp(POLL_TOKEN_PATTERN, "i").test(token)).toBe(false);
    },
  );
});