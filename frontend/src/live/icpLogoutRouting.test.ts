import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
import { markMountedAuthProvider } from "./authBackendMode";
import { applyBackendRoutingConfig } from "./backendRouting";
import { FEATURE_AREAS } from "./featureBackend";
import { getEffectiveBackendForFeature, isFeatureRoutedToIcp } from "./loadBackendRouting";

beforeEach(() => {
  localStorage.clear();
  applyBackendRoutingConfig(null);
  markMountedAuthProvider("icp");
});
afterEach(() => {
  markMountedAuthProvider("supabase");
  localStorage.clear();
  applyBackendRoutingConfig(null);
});

describe("ICP logout routing", () => {
  it("does not switch mounted ICP pages to Supabase after the session record is removed", () => {
    localStorage.setItem("ignite_icp_internet_identity_session", JSON.stringify({ principal: "test-person" }));
    expect(getEffectiveBackendForFeature("home")).toBe("icp");
    localStorage.removeItem("ignite_icp_internet_identity_session");
    for (const feature of FEATURE_AREAS) {
      expect(getEffectiveBackendForFeature(feature), feature).toBe("icp");
      expect(isFeatureRoutedToIcp(feature), feature).toBe(true);
    }
  });

  it("returns to Supabase only when the email provider is actually mounted", () => {
    markMountedAuthProvider("supabase");
    for (const feature of FEATURE_AREAS) {
      expect(getEffectiveBackendForFeature(feature), feature).toBe("supabase");
    }
  });
});