import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CHAT_READ_EXCLUDED_ID_PREFIXES,
  CHAT_READ_EXCLUDED_WITH_QUEUED_ID_PREFIXES,
  selectVisibleChatMessageIdsToMarkRead,
  useMarkVisibleChatMessagesRead,
} from "./useMarkVisibleChatMessagesRead";

const messages = [
  { id: "own", author_id: "viewer" },
  { id: "server-message", author_id: "other" },
  { id: "temp-local", author_id: "other" },
  { id: "queued-offline", author_id: "other" },
];

describe("useMarkVisibleChatMessagesRead", () => {
  it("excludes own and temporary messages while retaining server rows", () => {
    expect(
      selectVisibleChatMessageIdsToMarkRead(messages, "viewer", CHAT_READ_EXCLUDED_ID_PREFIXES),
    ).toEqual(["server-message", "queued-offline"]);
  });

  it("also excludes queued messages for the club-admin route", () => {
    expect(
      selectVisibleChatMessageIdsToMarkRead(
        messages,
        "viewer",
        CHAT_READ_EXCLUDED_WITH_QUEUED_ID_PREFIXES,
      ),
    ).toEqual(["server-message"]);
  });

  it("does not mark the same visible server message twice for deduplicated routes", () => {
    const markMessagesAsRead = vi.fn();
    const { rerender } = renderHook(
      ({ visibleMessages }) =>
        useMarkVisibleChatMessagesRead({
          messages: visibleMessages,
          userId: "viewer",
          markMessagesAsRead,
        }),
      { initialProps: { visibleMessages: messages } },
    );

    rerender({ visibleMessages: [...messages] });
    expect(markMessagesAsRead).toHaveBeenCalledTimes(1);
    expect(markMessagesAsRead).toHaveBeenCalledWith(["server-message", "queued-offline"]);
  });

  it("preserves the direct-message route's non-deduplicated marking policy", () => {
    const markMessagesAsRead = vi.fn();
    const { rerender } = renderHook(
      ({ visibleMessages }) =>
        useMarkVisibleChatMessagesRead({
          messages: visibleMessages,
          userId: "viewer",
          markMessagesAsRead,
          deduplicate: false,
        }),
      { initialProps: { visibleMessages: messages } },
    );

    rerender({ visibleMessages: [...messages] });
    expect(markMessagesAsRead).toHaveBeenCalledTimes(2);
    expect(markMessagesAsRead).toHaveBeenLastCalledWith(["server-message", "queued-offline"]);
  });
});
