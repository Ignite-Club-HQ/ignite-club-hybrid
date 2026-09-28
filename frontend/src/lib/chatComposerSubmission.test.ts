import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareChatComposerSubmission, resetChatComposerAfterSend } from "./chatComposerSubmission";

describe("prepareChatComposerSubmission", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("does nothing when composition was already flushed", () => {
    const retry = vi.fn();
    const dispatch = vi.spyOn(window, "dispatchEvent");

    expect(prepareChatComposerSubmission(true, retry)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it("announces a send without deferring when no text input is active", () => {
    const retry = vi.fn();
    const sent = vi.fn();
    window.addEventListener("chat:message-sent", sent, { once: true });

    expect(prepareChatComposerSubmission(false, retry)).toBe(false);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("blurs an active composer, retries once, and restores focus without scrolling", () => {
    vi.useFakeTimers();
    const composer = document.createElement("textarea");
    document.body.append(composer);
    composer.focus();
    const blur = vi.spyOn(composer, "blur");
    const focus = vi.spyOn(composer, "focus");
    const retry = vi.fn();

    expect(prepareChatComposerSubmission(false, retry)).toBe(true);
    expect(blur).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(retry).toHaveBeenCalledExactlyOnceWith(true);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });
});

describe("resetChatComposerAfterSend", () => {
  it("clears text, attachment, reply and poll together", () => {
    const setText = vi.fn();
    const setImage = vi.fn();
    const setReply = vi.fn();
    const setPoll = vi.fn();

    resetChatComposerAfterSend({ setText, setImage, setReply, setPoll });

    expect(setText).toHaveBeenCalledExactlyOnceWith("");
    expect(setImage).toHaveBeenCalledExactlyOnceWith(null);
    expect(setReply).toHaveBeenCalledExactlyOnceWith(null);
    expect(setPoll).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("supports composers that do not own a poll field", () => {
    const setText = vi.fn();
    const setImage = vi.fn();
    const setReply = vi.fn();

    expect(() => resetChatComposerAfterSend({ setText, setImage, setReply })).not.toThrow();
  });
});
