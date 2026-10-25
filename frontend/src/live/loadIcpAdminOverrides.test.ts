import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ email: false, ii: true, read: vi.fn(), from: vi.fn(), apply: vi.fn(), parse: vi.fn() }));
vi.mock("./loadBackendRouting", () => ({ isSignedInWithEmail: () => m.email, hasStoredInternetIdentitySession: () => m.ii }));
vi.mock("./appConfig", () => ({ readLiveAppConfig: m.read }));
vi.mock("./icpAdminOverrides", () => ({ ICP_CANISTER_CONFIG_KEY: "icp_canister_config", applyIcpAdminOverrides: m.apply, parseIcpAdminOverrides: m.parse }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: m.from } }));
import { loadIcpAdminOverrides } from "./loadIcpAdminOverrides";
beforeEach(() => { vi.clearAllMocks(); m.email = false; m.ii = true; m.parse.mockImplementation(async value => value); m.read.mockResolvedValue(null); });
describe("ICP canister override isolation", () => {
  it("loads on-chain configuration without Supabase", async () => {
    const value = { canisterIds: { club_domain: "club" } }; m.read.mockResolvedValue(JSON.stringify(value));
    await loadIcpAdminOverrides(); expect(m.apply).toHaveBeenCalledWith(value); expect(m.from).not.toHaveBeenCalled();
  });
  it("retains current overrides on an ambiguous missing read", async () => {
    await loadIcpAdminOverrides(); expect(m.apply).not.toHaveBeenCalled(); expect(m.from).not.toHaveBeenCalled();
  });
  it("retains current overrides on malformed data", async () => {
    m.read.mockResolvedValue("broken"); const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadIcpAdminOverrides(); expect(m.apply).not.toHaveBeenCalled(); expect(m.from).not.toHaveBeenCalled(); warn.mockRestore();
  });
  it("preserves email-mode Supabase loading", async () => {
    m.email = true; const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { value: { canisterIds: {} } }, error: null }) }; m.from.mockReturnValue(chain);
    await loadIcpAdminOverrides(); expect(m.from).toHaveBeenCalledWith("app_settings"); expect(m.read).not.toHaveBeenCalled();
  });
});