import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGroupLocalMessagesSync } from "./useGroupLocalMessagesSync";
import type { GroupMessage } from "./groupChatData";

vi.mock("@/lib/messageCache", () => ({ cacheMessages: vi.fn() }));

describe("group photo send local rendering", () => {
  it("removes the blob preview when its acknowledged row arrives with a stored URL", () => {
    const preview = {
      id: "temp-photo", group_id: "group-1", author_id: "member", text: "",
      image_url: "blob:preview", created_at: "2026-10-18T05:51:00Z",
      reply_to_id: null, author: null, reply_to: null,
    } as GroupMessage;
    const saved = {
      ...preview, id: "saved-photo", text: " ", image_url: "https://stored/photo",
      optimistic_id: preview.id,
    };
    const { result, rerender } = renderHook(({ messages }) => {
      const [localMessages, setLocalMessages] = useState<GroupMessage[] | undefined>([preview]);
      useGroupLocalMessagesSync({
        messages, reactions: [], groupId: "group-1", threadPhase: "ready",
        reconcileScope: "group:photo-test", localMessages, setLocalMessages,
      });
      return localMessages;
    }, { initialProps: { messages: [preview] } });
    act(() => rerender({ messages: [saved] }));
    expect(result.current?.map((row) => row.id)).toEqual(["saved-photo"]);
    expect(result.current?.[0]?.image_url).toBe("https://stored/photo");
    act(() => rerender({ messages: [{ ...saved, optimistic_id: undefined }] }));
    expect(result.current?.map((row) => row.id)).toEqual(["saved-photo"]);
  });
});