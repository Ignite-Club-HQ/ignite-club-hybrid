import { afterEach, describe, expect, it } from "vitest";
import { resolveAuthBackend, useIcpAuthScreen } from "./authBackendMode";
import { applyBackendRoutingConfig, cacheClubBackendHint } from "./backendRouting";
import { applyIcpAdminOverrides } from "./icpAdminOverrides";
import { setProfileCountry } from "./userCountry";
import { clearUserClubIds, setUserClubIds } from "./userClubs";

const VALID_CANISTER_ID = "ryjl3-tyaaa-aaaaa-aaaba-cai";

function resetState(): void {
  applyBackendRoutingConfig(null);
  applyIcpAdminOverrides(null);
  setProfileCountry(null);
  clearUserClubIds();
  cacheClubBackendHint(null);
}

afterEach(resetState);

describe("resolveAuthBackend", () => {
  it("defaults to Supabase with no admin configuration", () => {
    resetState();
    expect(resolveAuthBackend()).toBe("supabase");
    expect(useIcpAuthScreen()).toBe(false);
  });

  it("keeps Supabase when the default backend is ICP but no canisters are configured", () => {
    applyBackendRoutingConfig({
      defaultBackend: "icp",
      countryRules: {},
      targets: [],
      countryTargets: {},
    });
    expect(resolveAuthBackend()).toBe("supabase");
    expect(useIcpAuthScreen()).toBe(false);
  });

  it("shows ICP auth when the default backend is ICP and canisters exist", () => {
    applyBackendRoutingConfig({
      defaultBackend: "icp",
      countryRules: {},
      targets: [],
      countryTargets: {},
    });
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
    expect(resolveAuthBackend()).toBe("icp");
    expect(useIcpAuthScreen()).toBe(true);
  });

  it("honours a Supabase-only country rule even when the default is ICP", () => {
    applyBackendRoutingConfig({
      defaultBackend: "icp",
      countryRules: { AU: "supabase" },
      targets: [],
      countryTargets: {},
    });
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
    setProfileCountry("AU");
    expect(resolveAuthBackend()).toBe("supabase");
    setProfileCountry("US");
    expect(resolveAuthBackend()).toBe("icp");
  });

  it("honours an ICP-only country rule even when the default is Supabase", () => {
    applyBackendRoutingConfig({
      defaultBackend: "supabase",
      countryRules: { DE: "icp" },
      targets: [],
      countryTargets: {},
    });
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
    setProfileCountry("DE");
    expect(resolveAuthBackend()).toBe("icp");
    setProfileCountry("US");
    expect(resolveAuthBackend()).toBe("supabase");
  });
});
