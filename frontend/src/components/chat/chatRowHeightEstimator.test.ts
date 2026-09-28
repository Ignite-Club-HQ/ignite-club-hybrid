import { beforeEach, describe, expect, it } from "vitest";
import { clearChatRowHeightCache, setCachedRowHeight } from "./chatRowHeightCache";
import { estimateChatRowHeight } from "./chatRowHeightEstimator";
import { createChatRowSignature } from "./chatRowSignature";

const base = {
  id: "message-1",
  author_id: "author-1",
  author_name: "Alex",
  text: "Hello",
  created_at: "2026-08-06T10:00:00.000Z",
};

describe("chat row height estimator", () => {
  beforeEach(() => clearChatRowHeightCache());

  it("accounts for date separator and hides the author header on own messages", () => {
    expect(estimateChatRowHeight(base, 0, [base], "viewer")).toBe(122);
    expect(estimateChatRowHeight(base, 0, [base], "author-1")).toBe(98);
  });

  it("uses the compact normal system row and distinct gallery-card heights", () => {
    expect(estimateChatRowHeight({ ...base, is_system_message: true }, 0, [{ ...base, is_system_message: true }], "viewer")).toBe(108);
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const prompt = { ...base, text: `[galleryprompt:${id}]`, is_system_message: true };
    const gallery = { ...base, text: `[gallery:${id}]`, is_system_message: true };
    expect(estimateChatRowHeight(prompt, 0, [prompt], "viewer")).toBe(148);
    expect(estimateChatRowHeight(gallery, 0, [gallery], "viewer")).toBe(312);
  });

  it("reduces chrome for a grouped follow-up", () => {
    const previous = { ...base, id: "previous", created_at: "2026-08-06T09:59:00.000Z" };
    expect(estimateChatRowHeight(base, 1, [previous, base], "viewer")).toBe(56);
  });

  it("reserves reply and unknown-image geometry", () => {
    const plain = { ...base, created_at: null };
    const reply = { ...plain, reply_to_id: "parent" };
    const image = { ...plain, text: "", image_url: "https://local.test/unknown-image.jpg" };
    expect(estimateChatRowHeight(reply, 0, [reply], "viewer") - estimateChatRowHeight(plain, 0, [plain], "viewer")).toBe(70);
    expect(estimateChatRowHeight(image, 0, [image], "viewer")).toBe(299);
  });

  it("adds one reaction row per four reaction chips", () => {
    const four = { ...base, created_at: null, reactions: Array.from({ length: 4 }, () => ({ emoji: "👍" })) };
    const five = { ...base, created_at: null, reactions: Array.from({ length: 5 }, () => ({ emoji: "👍" })) };
    expect(estimateChatRowHeight(five, 0, [five], "viewer") - estimateChatRowHeight(four, 0, [four], "viewer")).toBe(28);
  });

  it("caps exceptionally long message estimates", () => {
    const long = { ...base, text: "x".repeat(20_000) };
    expect(estimateChatRowHeight(long, 0, [long], "viewer")).toBe(1400);
  });

  it("reuses a measured height only while its signature still matches", () => {
    const signature = createChatRowSignature(base, 0, [base], "viewer");
    setCachedRowHeight(base.id, 321, signature);
    expect(estimateChatRowHeight(base, 0, [base], "viewer")).toBe(321);
    const edited = { ...base, text: "Changed" };
    expect(estimateChatRowHeight(edited, 0, [edited], "viewer")).not.toBe(321);
  });
});
