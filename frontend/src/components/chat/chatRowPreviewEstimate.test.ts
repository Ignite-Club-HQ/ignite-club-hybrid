import { describe, expect, it } from "vitest";
import {
  CHAT_PREVIEW_HEIGHT_BY_TOKEN,
  estimateExternalChatPreviewHeight,
  estimateVisibleChatText,
} from "./chatRowPreviewEstimate";

describe("chat row preview estimation", () => {
  it("keeps visible mention and markdown labels while removing rich-card tokens", () => {
    expect(
      estimateVisibleChatText(
        "Hi @[Alex Parent](user-1) see [details](https://example.com) [event:event-1] [vault:file-1]",
      ),
    ).toBe("Hi Alex Parent see details");
  });

  it("removes event deep links and YouTube URLs from normal text measurement", () => {
    const eventId = "123e4567-e89b-12d3-a456-426614174000";
    expect(
      estimateVisibleChatText(`Watch https://youtu.be/demo https://app.test/events/${eventId}?from=chat`),
    ).toBe("Watch");
  });

  it("reserves bounded visible width for an ordinary URL", () => {
    const visible = estimateVisibleChatText(`Open https://example.com/${"a".repeat(100)}`);
    expect(visible).toBe(`Open ${"x".repeat(50)}`);
  });

  it("deduplicates preview URLs case-insensitively", () => {
    expect(
      estimateExternalChatPreviewHeight("https://example.com/a HTTPS://EXAMPLE.COM/A"),
    ).toBe(CHAT_PREVIEW_HEIGHT_BY_TOKEN.url);
  });

  it("caps external previews at two YouTube cards and two ordinary links", () => {
    const text = [
      "https://youtu.be/a",
      "https://youtube.com/watch?v=b",
      "https://youtube.com/shorts/c",
      "https://one.example/a",
      "https://two.example/b",
      "https://three.example/c",
    ].join(" ");
    expect(estimateExternalChatPreviewHeight(text)).toBe(180 * 2 + 8 + 80 * 2 + 8);
  });

  it("keeps card constants aligned with first-paint reserved heights", () => {
    expect(CHAT_PREVIEW_HEIGHT_BY_TOKEN).toEqual({
      event: 76,
      poll: 180,
      board: 80,
      vault: 64,
      vaultfolder: 64,
      vaultroot: 64,
      gallery: 240,
      galleryprompt: 76,
      url: 80,
    });
  });
});
