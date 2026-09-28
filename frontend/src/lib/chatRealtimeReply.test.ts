import { describe, expect, it } from "vitest";
import { findLocalReplyMessage } from "./chatRealtimeReply";

describe("findLocalReplyMessage", () => {
  const messages = [
    { id: "m1", text: "first" },
    { id: "m2", text: "second" },
  ];

  it("returns an already-loaded reply target synchronously", () => {
    expect(findLocalReplyMessage(messages, "m2")).toBe(messages[1]);
  });

  it("returns null only when the target is not locally available", () => {
    expect(findLocalReplyMessage(messages, "missing")).toBeNull();
    expect(findLocalReplyMessage(messages, null)).toBeNull();
  });
});