import { describe, it, expect } from "vitest";
import { liveMessageRow } from "./liveMessageRow";
describe("acknowledged ICP messages", () => {
  it("retains the authoritative ID, sender, time and reply", () => {
    expect(liveMessageRow({ id: "confirmed-7", conversation_id: "dm-3", sender: { toText: () => "sender" }, body: "Hello", created_at_ms: 1_700_000_000_000n, reply_to_id: ["reply-1"], attachment: [{ kind: "image", url: ["blob:authorized"] }] })).toEqual({ id: "confirmed-7", conversation_id: "dm-3", author_id: "sender", text: "Hello", created_at: "2023-11-14T22:13:20.000Z", reply_to_id: "reply-1", image_url: "blob:authorized" });
  });
  it("refuses an unacknowledged identity rather than inventing a delivered ID", () => {
    expect(() => liveMessageRow({ id: "", conversation_id: "dm-3", sender: { toText: () => "sender" }, body: "Hello", created_at_ms: 0n, reply_to_id: [], attachment: [] })).toThrow("Missing acknowledged message identity");
  });
});