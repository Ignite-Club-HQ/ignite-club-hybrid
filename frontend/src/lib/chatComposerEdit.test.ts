import { describe, expect, it } from "vitest";
import {
  beginChatMessageEdit,
  buildChatMessageEdit,
  cancelChatMessageEdit,
} from "./chatComposerEdit";

describe("chat composer edit intent", () => {
  it("retains the original message object when an edit begins", () => {
    const message = { id: "message-1", text: "Original", scope: "group" };

    const result = beginChatMessageEdit(message);

    expect(result).toEqual({ editingMessage: message, composerText: "Original" });
    expect(result.editingMessage).toBe(message);
  });

  it("builds the persisted edit from the immutable id and trimmed draft", () => {
    expect(buildChatMessageEdit(
      { id: "message-1", text: "Original" },
      "  Updated message  ",
    )).toEqual({ messageId: "message-1", text: "Updated message" });
  });

  it("does not build an update when no message is being edited", () => {
    expect(buildChatMessageEdit(null, "Updated message")).toBeNull();
  });

  it("clears both edit identity and composer text on cancellation", () => {
    expect(cancelChatMessageEdit()).toEqual({ editingMessage: null, composerText: "" });
  });
});
