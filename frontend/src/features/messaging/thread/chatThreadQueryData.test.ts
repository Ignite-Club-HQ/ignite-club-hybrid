import { describe, expect, it } from "vitest";
import { extractChatQueryMessages } from "./chatThreadQueryData";

interface MessageStub {
  id: string;
}

describe("extractChatQueryMessages", () => {
  it("retains a legacy message-array result without cloning it", () => {
    const messages: MessageStub[] = [{ id: "message-1" }];

    expect(extractChatQueryMessages(messages)).toBe(messages);
  });

  it("retains the messages inside a query envelope without cloning them", () => {
    const messages: MessageStub[] = [{ id: "message-1" }];

    expect(extractChatQueryMessages({ messages })).toBe(messages);
  });

  it.each([undefined, null, {}, { messages: undefined }])(
    "returns an empty array for unresolved or incomplete data %#",
    (data) => {
      expect(extractChatQueryMessages<MessageStub>(data)).toEqual([]);
    },
  );

  it("does not sort or otherwise mutate the query result", () => {
    const messages: MessageStub[] = [{ id: "message-2" }, { id: "message-1" }];

    expect(extractChatQueryMessages(messages)).toEqual(messages);
    expect(messages.map((message) => message.id)).toEqual(["message-2", "message-1"]);
  });
});
