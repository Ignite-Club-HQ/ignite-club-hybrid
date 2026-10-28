import { describe, it, expect } from "vitest";
import { isChatProvisioningRefusal } from "./messaging";

describe("isChatProvisioningRefusal", () => {
  it("retries chat setup only on explicit not-provisioned refusals", () => {
    expect(isChatProvisioningRefusal(new Error("Send message: Conversation access forbidden"))).toBe(true);
    expect(isChatProvisioningRefusal(new Error("Failed to fetch"))).toBe(false);
    expect(isChatProvisioningRefusal(new Error("Only group admins can post"))).toBe(false);
  });
});
