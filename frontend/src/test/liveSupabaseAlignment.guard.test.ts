import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, relativePath), "utf8");

const productMain = read("../product-main.tsx");
const authRetry = read("../lib/supabaseAuthRetry.ts");
const completeProfile = read("../pages/CompleteProfilePage.tsx");
const liveClient = read("../integrations/supabase/liveClient.ts");

describe("live Supabase compatibility guards", () => {
  it("installs the auth retry wrapper before rendering the product app", () => {
    const installIndex = productMain.indexOf("installSupabaseAuthRetry();");
    const renderIndex = productMain.indexOf("createRoot(root).render(");

    expect(installIndex).toBeGreaterThan(-1);
    expect(renderIndex).toBeGreaterThan(installIndex);
  });

  it("discovers the guarded live target from the active Supabase client", () => {
    expect(authRetry).toMatch(/\.supabaseUrl/);
    expect(authRetry).toMatch(/const supabaseUrl = getSupabaseUrl\(\)/);
  });

  it("keeps the aliased live client aligned with Supabase defaults", () => {
    expect(liveClient).toMatch(
      /createClient<Database>\(target\.url, target\.anonKey\)/
    );
    expect(liveClient).not.toMatch(/storageKey/);
    expect(liveClient).not.toMatch(/x-ignite-backend-target/);
  });

  it("server-validates the authenticated user before writing a profile", () => {
    const getUserIndex = completeProfile.indexOf("supabase.auth.getUser()");
    const updateIndex = completeProfile.indexOf(".update(profileValues", getUserIndex);
    const insertIndex = completeProfile.indexOf(".insert({", updateIndex);

    expect(getUserIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(getUserIndex);
    expect(insertIndex).toBeGreaterThan(updateIndex);
    expect(completeProfile).toMatch(/id: authenticatedUser\.id/);
    expect(completeProfile).toMatch(/authenticatedUser\.id !== user\.id/);
  });
});
