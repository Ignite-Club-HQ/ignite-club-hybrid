import { describe, expect, it } from "vitest";
import { EVENT_TOKEN_PATTERN, EVENT_URL_PATTERN } from "./chatEventToken";
import { extractEventIds, formatMessagePreview } from "./messagePreview";

const icpId = "evt-c1f2ed52-fda3-45b4-84d3-57fcf253116e-213";
const uuid = "c1f2ed52-fda3-45b4-84d3-57fcf253116e";

describe("shared event ID recognition", () => {
  it.each([uuid, icpId])("keeps the complete event ID %s", (id) => {
    expect(new RegExp(EVENT_TOKEN_PATTERN, "i").exec(`[event:${id}]`)?.[1]).toBe(id);
    expect(extractEventIds(`[event:${id}]`)).toEqual([id]);
  });

  it("removes the whole ICP token without consuming a caption", () => {
    const text = `Join us [event:${icpId}] tomorrow`;
    expect(text.replace(new RegExp(EVENT_TOKEN_PATTERN, "gi"), "")).toBe("Join us  tomorrow");
  });

  it("resolves the full ICP ID against the event title lookup", () => {
    expect(formatMessagePreview(`[event:${icpId}]`, { eventTitles: { [icpId]: "Training" } })).toContain("Training");
    expect(formatMessagePreview(`[event:${icpId}]`)).not.toContain(icpId);
  });

  it.each([`/events/${icpId}`, `https://example.com/events/${icpId}?from=chat`])("recognises event URL %s", (url) => {
    expect(new RegExp(EVENT_URL_PATTERN, "i").exec(url)?.[1]).toBe(icpId);
  });

  it.each(["[event:]", "[event:bad id]", "[event:unclosed", "[poll:evt-one-1]"])("rejects invalid event token %s", (text) => {
    expect(new RegExp(EVENT_TOKEN_PATTERN, "i").test(text)).toBe(false);
  });
});