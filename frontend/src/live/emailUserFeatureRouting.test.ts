import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("./authBackendMode", () => ({ isSignedInWithEmail: () => true }));
vi.mock("./userClubs", () => ({ getUserClubIds: () => ["club-icp"] }));
vi.mock("./targetRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./targetRegistry")>()),
  getActiveIcpTarget: () => ({ alias: "main", canisterIds: { messaging_domain: "aaaaa-aa", media_metadata: "aaaaa-aa" } }),
}));

import { applyBackendRoutingConfig } from "./backendRouting";
import { getEffectiveBackendForFeature, isFeatureRoutedToIcp } from "./loadBackendRouting";

describe("email sign-in in an ICP-pinned club", () => {
  it("keeps every feature on Supabase", () => {
    applyBackendRoutingConfig({
      defaultBackend: "supabase",
      countryRules: {},
      targets: [],
      clubBackendOverrides: { "club-icp": "icp" },
    } as never);
    expect(getEffectiveBackendForFeature("messaging")).toBe("supabase");
    expect(isFeatureRoutedToIcp("messaging")).toBe(false);
    expect(isFeatureRoutedToIcp("media")).toBe(false);
  });
});
