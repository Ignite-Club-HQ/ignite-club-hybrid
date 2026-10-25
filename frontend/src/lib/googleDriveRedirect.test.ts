import { describe, expect, it } from "vitest";
import { googleDriveRedirectUri } from "./googleDriveRedirect";

describe("Supabase Drive callback parity", () => {
  it("uses the production native callback rather than the WebView origin", () => {
    expect(googleDriveRedirectUri(true, "https://localhost")).toBe("https://igniteclubhq.app/vault");
  });
  it("keeps browser authorization and exchange on the current app origin", () => {
    expect(googleDriveRedirectUri(false, "https://ignite-canister-connect.lovable.app")).toBe("https://ignite-canister-connect.lovable.app/vault");
  });
});