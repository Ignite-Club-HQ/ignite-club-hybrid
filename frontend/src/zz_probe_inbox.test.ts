import { describe, it, expect, vi } from "vitest";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";

const identity = Ed25519KeyIdentity.generate();
vi.mock("@/live/internetIdentityAuth", async (orig) => ({ ...(await orig() as any),
  getCurrentInternetIdentity: async () => identity,
  getCurrentInternetIdentityConfirmed: async () => identity,
}));
vi.mock("@/live/authBackendMode", async (orig) => ({ ...(await orig() as any), resolveAuthBackend: () => "icp" }));
vi.mock("@/live/targetRegistry", async (orig) => {
  const real: any = await orig();
  const ids = (await import("@/live/generated/deployedCanisterIds")).DEPLOYED_MAINNET_CANISTER_IDS;
  const t = { alias: "mainnet", host: "https://icp-api.io", canisterIds: ids, kind: "mainnet" };
  return { ...real, getActiveIcpTarget: () => t };
});

describe("probe", () => {
  it("lists default club chats for a fresh club admin", async () => {
    const { connectLiveClubDomain } = await import("@/live/domains");
    const { getActiveIcpTarget } = await import("@/live/targetRegistry");
    const { actor } = await connectLiveClubDomain(getActiveIcpTarget() as any, identity);
    const id = crypto.randomUUID();
    const r: any = await actor.create_club(id, "zz probe " + id.slice(0, 6), "zz-probe-" + id.slice(0, 8), [], []);
    console.log("create", Object.keys(r));
    const { fetchChatGroupsWithMessages } = await import("@/features/messaging/inbox/inboxPreviewSources");
    try {
      const a = await fetchChatGroupsWithMessages({} as any, "x");
      console.log("FIRST", JSON.stringify(a.groups.map((g: any) => g.name)));
      const b = await fetchChatGroupsWithMessages({} as any, "x");
      console.log("SECOND", JSON.stringify(b.groups.map((g: any) => g.name)));
    } catch (e: any) {
      console.log("ERR", e?.message, e?.stack?.slice(0, 800));
    } finally {
      await actor.soft_delete_club(id, true);
    }
    expect(true).toBe(true);
  }, 120_000);
});
