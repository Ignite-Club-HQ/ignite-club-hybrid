import { describe, expect, it } from "vitest";
import { filterChatMessagesForSearch } from "./chatSearchPresentation";

const messages = [
  { id: "b", text: "Training reminder", created_at: "2026-09-19T10:00:00.000Z" },
  { id: "a", text: "Match details", created_at: "2026-09-19T09:00:00.000Z" },
  { id: "c", text: "Training plan", created_at: "2026-09-19T10:00:00.000Z" },
];

describe("filterChatMessagesForSearch", () => {
  it("returns undefined while the source page has not loaded messages", () => {
    expect(filterChatMessagesForSearch(undefined, "match")).toBeUndefined();
  });

  it("retains every message for a blank query and orders equal timestamps by ID", () => {
    expect(filterChatMessagesForSearch(messages, " ").map((message) => message.id))
      .toEqual(["a", "b", "c"]);
  });

  it("applies fuzzy text matching before deterministic chronological ordering", () => {
    expect(filterChatMessagesForSearch(messages, "training").map((message) => message.id))
      .toEqual(["b", "c"]);
  });
});
