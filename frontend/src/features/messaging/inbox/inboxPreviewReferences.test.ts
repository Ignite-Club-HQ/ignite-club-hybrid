import { describe, expect, it } from "vitest";
import { collectInboxPreviewReferences } from "./inboxPreviewReferences";

const EVENT_A = "11111111-1111-4111-8111-111111111111";
const EVENT_B = "22222222-2222-4222-8222-222222222222";
const FOLDER = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";

describe("collectInboxPreviewReferences", () => {
  it("returns empty ordered collections without previews", () => {
    expect(collectInboxPreviewReferences([{ lastMessage: undefined }, {}])).toEqual({
      eventIds: [], vaultFolderIds: [], vaultFileIds: [],
    });
  });

  it("collects every supported preview reference in one pass", () => {
    const result = collectInboxPreviewReferences([{ lastMessage: {
      text: `See [event:${EVENT_A}], [vaultfolder:${FOLDER}] and [vault:${FILE}]`,
    } }]);
    expect(result).toEqual({ eventIds: [EVENT_A], vaultFolderIds: [FOLDER], vaultFileIds: [FILE] });
  });

  it("deduplicates repeated ids across and within conversations", () => {
    const result = collectInboxPreviewReferences([
      { lastMessage: { text: `[event:${EVENT_A}] [event:${EVENT_A}]` } },
      { lastMessage: { text: `[event:${EVENT_A}] [vault:${FILE}]` } },
      { lastMessage: { text: `[vault:${FILE}]` } },
    ]);
    expect(result.eventIds).toEqual([EVENT_A]);
    expect(result.vaultFileIds).toEqual([FILE]);
  });

  it("preserves first-seen order for stable query keys", () => {
    const result = collectInboxPreviewReferences([
      { lastMessage: { text: `[event:${EVENT_B}] [event:${EVENT_A}]` } },
      { lastMessage: { text: `[event:${EVENT_B}]` } },
    ]);
    expect(result.eventIds).toEqual([EVENT_B, EVENT_A]);
  });

  it("normalizes uppercase token ids through the established extractors", () => {
    const result = collectInboxPreviewReferences([
      { lastMessage: { text: `[EVENT:${EVENT_A.toUpperCase()}]` } },
    ]);
    expect(result.eventIds).toEqual([EVENT_A]);
  });

  it("ignores malformed and unrelated tokens", () => {
    const result = collectInboxPreviewReferences([
      { lastMessage: { text: "[event:not-a-uuid] [poll:11111111-1111-4111-8111-111111111111] plain" } },
    ]);
    expect(result).toEqual({ eventIds: [], vaultFolderIds: [], vaultFileIds: [] });
  });
});
