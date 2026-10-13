import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ latest: vi.fn(), profiles: vi.fn(), roles: vi.fn(), clubs: vi.fn() }));
vi.mock("@/lab/fixtureDataLayer", () => ({}));
vi.mock("@/lib/profileCache", () => ({}));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("@/live/internetIdentityAuth", () => ({
  getCurrentInternetIdentity: async () => ({ getPrincipal: () => ({ toText: () => "sender" }) }),
}));
vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({}) }));
vi.mock("@/live/features/identityAccessClient", () => ({ listLiveProfilesByIds: mocks.profiles }));
vi.mock("@/live/features/membership", () => ({
  getLiveMyRoleGrants: mocks.roles, listLiveMembershipClubs: mocks.clubs, listLiveMembershipTeams: vi.fn(),
}));
vi.mock("@/live/features/messaging", () => ({ listLiveLatestMessagesPage: mocks.latest }));
import { fetchMemberClubsWithMessages } from "./inboxPreviewSources";

describe("ICP club photo previews", () => {
  const client = { from: vi.fn(), rpc: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.roles.mockResolvedValue([{ club: ["giddy-goat"] }]);
    mocks.clubs.mockResolvedValue([{ id: "giddy-goat", name: "Giddy Goat", logo_url: [], deleted_at_ms: [] }]);
    mocks.latest.mockResolvedValue({ messages: [{ body: "", created_at_ms: 1791875820000n,
      sender: { toText: () => "sender" }, attachment: [{ kind: "image", url: ["photo-url"], ref_id: "photo-ref" }],
    }] });
    mocks.profiles.mockResolvedValue([{ account_id: "sender", display_name: "Paul Cranwell" }]);
  });
  it("reads the known club directly and retains an image-only latest message", async () => {
    const result = await fetchMemberClubsWithMessages(client, "me", true);
    expect(mocks.latest).toHaveBeenCalledWith(expect.anything(), "giddy-goat", null, 1);
    expect(result.latestMessages["giddy-goat"]).toEqual({
      text: "", author: "Paul Cranwell", image_url: "photo-url", created_at: new Date(1791875820000).toISOString(),
    });
    expect(client.from).not.toHaveBeenCalled();
  });
  it("keeps the image preview when the sender directory is temporarily unavailable", async () => {
    mocks.profiles.mockRejectedValue(new Error("Directory unavailable"));
    const result = await fetchMemberClubsWithMessages(client, "me", true);
    expect(result.latestMessages["giddy-goat"]).toMatchObject({ text: "", image_url: "photo-url", author: "" });
  });
  it("isolates an unreadable club without losing another club's photo", async () => {
    mocks.roles.mockResolvedValue([{ club: ["giddy-goat"] }, { club: ["other"] }]);
    mocks.clubs.mockResolvedValue([{ id: "giddy-goat" }, { id: "other" }]);
    mocks.latest.mockRejectedValueOnce(new Error("Access forbidden"));
    const result = await fetchMemberClubsWithMessages(client, "me", true);
    expect(result.latestMessages["giddy-goat"]).toBeUndefined();
    expect(result.latestMessages.other.image_url).toBe("photo-url");
  });
});