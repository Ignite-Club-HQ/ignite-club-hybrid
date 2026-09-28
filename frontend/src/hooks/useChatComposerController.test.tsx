import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useChatComposerController } from "./useChatComposerController";

beforeEach(() => sessionStorage.clear());

describe("useChatComposerController", () => {
  it("persists the draft and derives send eligibility from text, image or poll", () => {
    const { result } = renderHook(() => useChatComposerController("controller-test"));
    expect(result.current.canSend).toBe(false);

    act(() => result.current.setText("hello"));
    expect(result.current.canSend).toBe(true);
    expect(JSON.parse(sessionStorage.getItem("chat_draft_controller-test")!).text).toBe("hello");

    act(() => {
      result.current.setText("");
      result.current.setImageUrl("image.jpg");
    });
    expect(result.current.canSend).toBe(true);

    act(() => {
      result.current.setImageUrl(null);
      result.current.setPendingPollId("poll-1");
    });
    expect(result.current.canSend).toBe(true);
  });

  it("restores both draft text and its exact reply target after remount", () => {
    const first = renderHook(() => useChatComposerController("remount-test"));
    const reply = { id: "message-42", text: "Original message", authorName: "Alex" };
    act(() => {
      first.result.current.setText("My unsent reply");
      first.result.current.setReplyingTo(reply);
    });
    first.unmount();

    const second = renderHook(() => useChatComposerController("remount-test"));
    expect(second.result.current.text).toBe("My unsent reply");
    expect(second.result.current.replyingTo).toEqual(reply);
    expect(second.result.current.buildSubmission()).toMatchObject({
      text: "My unsent reply",
      replyToId: "message-42",
    });
  });

  it("starts and cancels editing without retaining a reply target", () => {
    const { result } = renderHook(() => useChatComposerController("edit-test"));
    act(() => result.current.setReplyingTo({ id: "reply-1", text: "parent", authorName: "Alex" }));
    act(() => result.current.beginEdit({ id: "message-1", text: "original" }));

    expect(result.current.editingMessage).toEqual({ id: "message-1", text: "original" });
    expect(result.current.text).toBe("original");
    expect(result.current.replyingTo).toBeNull();

    act(() => result.current.cancelEdit());
    expect(result.current.editingMessage).toBeNull();
    expect(result.current.text).toBe("");
  });

  it("can preserve the reply target when a surface historically did so on edit", () => {
    const { result } = renderHook(() =>
      useChatComposerController("preserved-reply-edit-test", { clearReplyOnEdit: false }),
    );
    const reply = { id: "reply-1", text: "parent", authorName: "Alex" };
    act(() => result.current.setReplyingTo(reply));
    act(() => result.current.beginEdit({ id: "message-1", text: "original" }));

    expect(result.current.editingMessage).toEqual({ id: "message-1", text: "original" });
    expect(result.current.text).toBe("original");
    expect(result.current.replyingTo).toEqual(reply);
  });

  it("builds the exact poll-marked submission without mutating composer state", () => {
    const { result } = renderHook(() => useChatComposerController("payload-test"));
    act(() => {
      result.current.setText("Update");
      result.current.setImageUrl("image.jpg");
      result.current.setReplyingTo({ id: "reply-1", text: "parent", authorName: null });
      result.current.setPendingPollId("poll-1");
    });

    expect(result.current.buildSubmission()).toEqual({
      text: "Update [poll:poll-1]",
      imageUrl: "image.jpg",
      replyToId: "reply-1",
    });
    expect(result.current.text).toBe("Update");
  });

  it("clears every submitted field together while finishEdit clears only edit state and text", () => {
    const { result } = renderHook(() => useChatComposerController("reset-test"));
    act(() => {
      result.current.setText("sent");
      result.current.setImageUrl("image.jpg");
      result.current.setReplyingTo({ id: "reply-1", text: "parent", authorName: null });
      result.current.setPendingPollId("poll-1");
      result.current.resetAfterSend();
    });

    expect(result.current.text).toBe("");
    expect(result.current.imageUrl).toBeNull();
    expect(result.current.replyingTo).toBeNull();
    expect(result.current.pendingPollId).toBeNull();
  });

  it("restores failed fields only into slots the user has not replaced", () => {
    const { result } = renderHook(() => useChatComposerController("failure-test"));
    const oldReply = { id: "reply-old", text: "old", authorName: "Alex" };
    const context = {
      tempId: "temp-1",
      sentText: "failed text",
      sentImageUrl: "failed.jpg",
      previousReplyTarget: oldReply,
      pendingPollId: "poll-old",
      sentAtMs: Date.now(),
    };

    act(() => result.current.restoreAfterFailedSend(context));
    expect(result.current.text).toBe("failed text");
    expect(result.current.imageUrl).toBe("failed.jpg");
    expect(result.current.replyingTo).toEqual(oldReply);
    expect(result.current.pendingPollId).toBe("poll-old");

    act(() => {
      result.current.setText("newer text");
      result.current.setImageUrl("newer.jpg");
      result.current.setReplyingTo({ id: "reply-new", text: "new", authorName: null });
      result.current.setPendingPollId("poll-new");
      result.current.restoreAfterFailedSend(context);
    });
    expect(result.current.text).toBe("newer text");
    expect(result.current.imageUrl).toBe("newer.jpg");
    expect(result.current.replyingTo?.id).toBe("reply-new");
    expect(result.current.pendingPollId).toBe("poll-new");
  });
});
