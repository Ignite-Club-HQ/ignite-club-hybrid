import { describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), dispose: vi.fn() }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: async (_: unknown, p: { icp: (c: unknown) => unknown }) => p.icp({ target: {}, identity: {} }) }));
vi.mock("@/live/identityAccess", () => ({ connectLiveIdentityAccessClientWithIdentity: async () => ({ client: { whoami: async () => ({ id: "exact-account" }), getPrivacyConsent: m.read, setPrivacyConsent: m.write, dispose: m.dispose } }) }));
import { icpInvitePhotoConsent } from "./invitePhotoConsent";
describe("ICP invitation photo consent", () => {
  it("reads consent for the authoritative account", async () => {
    m.read.mockResolvedValue(true);
    expect(await icpInvitePhotoConsent()).toBe(true);
    expect(m.read).toHaveBeenCalledWith("exact-account", "photo");
  });
  it("writes consent on the shared identity canister", async () => {
    await icpInvitePhotoConsent(true);
    expect(m.write).toHaveBeenCalledWith("exact-account", "photo", true);
  });
});