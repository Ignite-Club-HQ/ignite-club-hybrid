import { describe, it, expect, vi, beforeEach } from "vitest";
const send = vi.fn(); const ensure = vi.fn();
vi.mock("@/live/liveClient", async (orig) => ({ ...(await orig() as object) }));
import * as m from "./messaging";
describe("isChatProvisioningRefusal", () => {
  it("retries only on explicit not-provisioned refusals", () => {
    expect(m.isChatProvisioningRefusal(new Error("Send message: Conversation access forbidden"))).toBe(true);
    expect(m.isChatProvisioningRefusal(new Error("Failed to fetch"))).toBe(false);
    expect(m.isChatProvisioningRefusal(new Error("Only group admins can post"))).toBe(false);
  });
});
void send; void ensure; void beforeEach;
