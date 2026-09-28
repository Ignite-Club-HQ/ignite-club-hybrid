import { describe, expect, it, vi } from "vitest";
import {
  buildChatScheduleTarget,
  resetChatComposerAfterSchedule,
} from "./chatScheduleIntent";

describe("chat scheduling intent", () => {
  it.each([
    ["team", "team-1", { chat_type: "team", team_id: "team-1" }],
    ["club", "club-1", { chat_type: "club", club_id: "club-1" }],
    ["group", "group-1", { chat_type: "group", group_id: "group-1" }],
    ["direct", "dm-1", { chat_type: "direct", conversation_id: "dm-1" }],
    ["club_admin", "admin-1", { chat_type: "club_admin", conversation_id: "admin-1" }],
  ] as const)("builds the exact %s schedule scope", (kind, id, expected) => {
    expect(buildChatScheduleTarget(kind, id)).toEqual(expected);
  });

  it.each(["team", "club", "group", "direct", "club_admin"] as const)(
    "does not expose a %s target before its scope is known",
    (kind) => expect(buildChatScheduleTarget(kind)).toBeNull(),
  );

  it("builds the id-free global broadcast target", () => {
    expect(buildChatScheduleTarget("broadcast")).toEqual({ chat_type: "broadcast" });
  });

  it("clears scheduled text, image and persisted draft in the existing order", () => {
    const calls: string[] = [];

    resetChatComposerAfterSchedule({
      setComposerText: (value) => calls.push(`text:${value}`),
      setImageUrl: (value) => calls.push(`image:${value}`),
      clearDraft: () => calls.push("draft"),
    });

    expect(calls).toEqual(["text:", "image:null", "draft"]);
  });

  it("supports surfaces whose schedule dialog does not own an image", () => {
    const setComposerText = vi.fn();
    const clearDraft = vi.fn();

    resetChatComposerAfterSchedule({ setComposerText, clearDraft });

    expect(setComposerText).toHaveBeenCalledWith("");
    expect(clearDraft).toHaveBeenCalledOnce();
  });
});
