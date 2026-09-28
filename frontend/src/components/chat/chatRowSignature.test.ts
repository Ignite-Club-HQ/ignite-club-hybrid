import { describe, expect, it } from "vitest";
import { setCachedImageAspectRatio } from "@/lib/chatImageAspectCache";
import { createChatRowSignature } from "./chatRowSignature";

const base = {
  id: "message-1",
  author_id: "user-1",
  author_name: "Alex",
  text: "Hello",
  created_at: "2026-08-06T10:00:00.000Z",
};

const signature = (message: unknown, messages: unknown[] = [message], userId = "user-2") =>
  createChatRowSignature(message, 0, messages, userId);

describe("chat row height signature", () => {
  it.each([
    ["text edit", { text: "Hello with a longer edit" }],
    ["edited marker", { edited_at: "2026-08-06T10:01:00.000Z" }],
    ["reply", { reply_to_id: "parent-1" }],
    ["reaction", { reactions: [{ emoji: "❤️", user_id: "user-2" }] }],
    ["preview hydration", { link_preview: { title: "Example" } }],
    ["read-state layout", { __readStateSignature: "read" }],
    ["author label", { author_name: "A much longer author display name" }],
  ])("changes when %s changes", (_label, change) => {
    expect(signature({ ...base, ...change })).not.toBe(signature(base));
  });

  it("changes when ownership changes", () => {
    expect(signature(base, [base], "user-1")).not.toBe(signature(base, [base], "user-2"));
  });

  it("changes when a preceding row creates or removes a date separator", () => {
    const sameDayPrevious = { ...base, id: "previous", created_at: "2026-08-06T09:00:00.000Z" };
    const priorDayPrevious = { ...sameDayPrevious, created_at: "2026-08-05T09:00:00.000Z" };
    expect(createChatRowSignature(base, 1, [sameDayPrevious, base], "user-2")).not.toBe(
      createChatRowSignature(base, 1, [priorDayPrevious, base], "user-2"),
    );
  });

  it("changes when neighbouring rows alter bubble grouping", () => {
    const groupedPrevious = { ...base, id: "previous", created_at: "2026-08-06T09:59:00.000Z" };
    const differentAuthor = { ...groupedPrevious, author_id: "user-3" };
    expect(createChatRowSignature(base, 1, [groupedPrevious, base], "user-2")).not.toBe(
      createChatRowSignature(base, 1, [differentAuthor, base], "user-2"),
    );

    const groupedNext = { ...base, id: "next", created_at: "2026-08-06T10:01:00.000Z" };
    expect(createChatRowSignature(base, 0, [base, groupedNext], "user-2")).not.toBe(
      createChatRowSignature(base, 0, [base, differentAuthor], "user-2"),
    );
  });

  it("changes after an image's real aspect ratio becomes known", () => {
    const image = { ...base, image_url: "https://local.test/signature-image.jpg" };
    const before = signature(image);
    setCachedImageAspectRatio([image.image_url], 2);
    expect(signature(image)).not.toBe(before);
  });

  it("is stable when non-layout payload details change", () => {
    expect(signature({ ...base, link_preview: { title: "One" } })).toBe(
      signature({ ...base, link_preview: { title: "Two", description: "Different metadata" } }),
    );
  });
});
