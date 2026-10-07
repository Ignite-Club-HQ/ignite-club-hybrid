import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
      clubBackendOverrides: {},
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
      clubBackendOverrides: {},
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
      clubBackendOverrides: {},
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
      clubBackendOverrides: {},
    });
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
    setProfileCountry("DE");
    expect(resolveAuthBackend()).toBe("icp");
    setProfileCountry("US");
    expect(resolveAuthBackend()).toBe("supabase");
  });
});

describe("resolveAuthBackend with per-club overrides", () => {
  const clubPinnedConfig = {
    defaultBackend: "supabase" as const,
    countryRules: {},
    targets: [],
    countryTargets: {},
    clubBackendOverrides: { "club-icp": "icp" as const, "club-supabase": "supabase" as const },
  };

  it("shows ICP auth when a member club is pinned to ICP and canisters exist", () => {
    applyBackendRoutingConfig(clubPinnedConfig);
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
    setUserClubIds(["club-icp"]);
    expect(resolveAuthBackend()).toBe("icp");
    expect(useIcpAuthScreen()).toBe(true);
  });

  it("keeps Supabase auth when a member club is pinned to ICP but no canisters exist", () => {
    applyBackendRoutingConfig(clubPinnedConfig);
    setUserClubIds(["club-icp"]);
    expect(resolveAuthBackend()).toBe("supabase");
  });

  it("a Supabase club pin wins over an ICP-only country rule", () => {
    applyBackendRoutingConfig({ ...clubPinnedConfig, countryRules: { DE: "icp" as const } });
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
    setProfileCountry("DE");
    setUserClubIds(["club-supabase"]);
    expect(resolveAuthBackend()).toBe("supabase");
  });

  it("pre-auth falls back to the cached club backend hint", () => {
    applyBackendRoutingConfig(clubPinnedConfig);
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
    cacheClubBackendHint("icp");
    expect(resolveAuthBackend()).toBe("icp");
    cacheClubBackendHint("supabase");
    expect(resolveAuthBackend()).toBe("supabase");
  });

  it("live membership ids take precedence over a stale cached hint", () => {
    applyBackendRoutingConfig(clubPinnedConfig);
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
    cacheClubBackendHint("icp");
    setUserClubIds(["club-supabase"]);
    expect(resolveAuthBackend()).toBe("supabase");
  });
});

describe("resolveAuthBackend with the ?auth= device override", () => {
  const icpDefaultConfig = {
    defaultBackend: "icp" as const,
    countryRules: {},
    targets: [],
    countryTargets: {},
    clubBackendOverrides: {},
  };

  function setUrlSearch(search: string): void {
    window.history.replaceState(null, "", `/auth${search}`);
  }

  function forgetChoice(): void {
    localStorage.removeItem("ignite.authChoice");
  }

  beforeEach(() => {
    resetState();
    forgetChoice();
    setUrlSearch("");
    applyIcpAdminOverrides({ canisterIds: { identity_access: VALID_CANISTER_ID } });
  });

  afterEach(() => {
    forgetChoice();
    setUrlSearch("");
  });

  it("?auth=icp forces the Internet Identity screen when routing says email", () => {
    setUrlSearch("?auth=icp");
    expect(resolveAuthBackend()).toBe("icp");
    expect(useIcpAuthScreen()).toBe(true);
  });

  it("?auth=email forces the email screen when the default backend is ICP", () => {
    applyBackendRoutingConfig(icpDefaultConfig);
    setUrlSearch("?auth=email");
    expect(resolveAuthBackend()).toBe("supabase");
    expect(useIcpAuthScreen()).toBe(false);
  });

  it("the choice keeps applying after the URL param is gone", () => {
    applyBackendRoutingConfig(icpDefaultConfig);
    setUrlSearch("?auth=email");
    expect(resolveAuthBackend()).toBe("supabase");
    setUrlSearch("");
    expect(resolveAuthBackend()).toBe("supabase");
  });

  it("?auth=auto forgets the stored choice so routing decides again", () => {
    applyBackendRoutingConfig(icpDefaultConfig);
    setUrlSearch("?auth=email");
    expect(resolveAuthBackend()).toBe("supabase");
    setUrlSearch("?auth=auto");
    expect(resolveAuthBackend()).toBe("icp");
  });

  it("?auth=icp cannot force ICP before canisters exist", () => {
    applyIcpAdminOverrides(null);
    setUrlSearch("?auth=icp");
    expect(resolveAuthBackend()).toBe("supabase");
  });
});
