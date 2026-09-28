import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  exchangeVaultDriveOAuthCode,
  getVaultDriveRedirectUri,
  isVaultDriveEnabled,
  resolveVaultDriveTitles,
  storeVaultDriveOAuthTokens,
} from "./vaultDriveService";

type IgniteSupabaseClient = SupabaseClient<Database>;

describe("Vault Google Drive feature boundary", () => {
  it("allows exactly the three established clubs", () => {
    expect(isVaultDriveEnabled("966bdaec-ebf1-46da-b2b3-cc53bf05c422")).toBe(true);
    expect(isVaultDriveEnabled("493ee2e3-c834-487d-93be-d1c8a0dbc4a8")).toBe(true);
    expect(isVaultDriveEnabled("36231b76-5313-478e-b8d5-23ac4f5e8b10")).toBe(true);
  });

  it("fails closed for absent and non-allowlisted clubs", () => {
    expect(isVaultDriveEnabled(undefined)).toBe(false);
    expect(isVaultDriveEnabled(null)).toBe(false);
    expect(isVaultDriveEnabled("another-club")).toBe(false);
  });

  it("invokes title resolution with only the exact club ID", async () => {
    const summary = { scanned: 4, updated: 3, unresolved: 1, errors: 0, hasOAuth: true };
    const invoke = vi.fn().mockResolvedValue({ data: { summary }, error: null });
    const client = { functions: { invoke } } as unknown as IgniteSupabaseClient;

    await expect(resolveVaultDriveTitles("club-a", client)).resolves.toBe(summary);
    expect(invoke).toHaveBeenCalledWith("resolve-drive-titles", { body: { clubId: "club-a" } });
  });

  it("preserves an absent summary for the existing no-change UI path", async () => {
    const client = {
      functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) },
    } as unknown as IgniteSupabaseClient;
    await expect(resolveVaultDriveTitles("club-a", client)).resolves.toBeUndefined();
  });

  it("propagates Edge Function failures", async () => {
    const denied = { message: "permission denied" };
    const client = {
      functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: denied }) },
    } as unknown as IgniteSupabaseClient;
    await expect(resolveVaultDriveTitles("club-a", client)).rejects.toBe(denied);
  });
});

describe("Vault Google Drive OAuth return", () => {
  beforeEach(() => sessionStorage.clear());

  it("uses the production callback on native and the current origin on web", () => {
    expect(getVaultDriveRedirectUri(true, "http://127.0.0.1:4173"))
      .toBe("https://igniteclubhq.app/vault");
    expect(getVaultDriveRedirectUri(false, "http://127.0.0.1:4173"))
      .toBe("http://127.0.0.1:4173/vault");
  });

  it("exchanges only the saved code and exact redirect URI", async () => {
    const tokens = { accessToken: "access-a", refreshToken: "refresh-a", googleEmail: "a@example.com" };
    const invoke = vi.fn().mockResolvedValue({ data: tokens, error: null });
    const client = { functions: { invoke } } as unknown as IgniteSupabaseClient;
    await expect(exchangeVaultDriveOAuthCode({
      code: "code-a",
      redirectUri: "https://igniteclubhq.app/vault",
    }, client)).resolves.toBe(tokens);
    expect(invoke).toHaveBeenCalledWith("google-drive-import?action=exchange-code", {
      body: { code: "code-a", redirectUri: "https://igniteclubhq.app/vault" },
    });
  });

  it("rejects transport, payload, and missing-token failures", async () => {
    for (const response of [
      { data: null, error: { message: "unavailable" } },
      { data: { error: "invalid code" }, error: null },
      { data: {}, error: null },
    ]) {
      const client = {
        functions: { invoke: vi.fn().mockResolvedValue(response) },
      } as unknown as IgniteSupabaseClient;
      await expect(exchangeVaultDriveOAuthCode({ code: "code-a", redirectUri: "uri-a" }, client))
        .rejects.toThrow();
    }
  });

  it("routes a pending folder link with precedence and exact link token keys", () => {
    sessionStorage.setItem("driveLinkPending", "{}");
    const route = storeVaultDriveOAuthTokens({
      accessToken: "access-a", refreshToken: "refresh-a", googleEmail: "a@example.com",
    }, sessionStorage);
    expect(route).toBe("link");
    expect(sessionStorage.getItem("driveLinkPending")).toBeNull();
    expect(sessionStorage.getItem("driveLinkAccessToken")).toBe("access-a");
    expect(sessionStorage.getItem("driveLinkRefreshToken")).toBe("refresh-a");
    expect(sessionStorage.getItem("driveLinkGoogleEmail")).toBe("a@example.com");
    expect(sessionStorage.getItem("googleDriveAccessToken")).toBeNull();
  });

  it("routes imports to their distinct token keys and omits absent optional values", () => {
    const route = storeVaultDriveOAuthTokens({ accessToken: "access-a" }, sessionStorage);
    expect(route).toBe("import");
    expect(sessionStorage.getItem("googleDriveAccessToken")).toBe("access-a");
    expect(sessionStorage.getItem("googleDriveRefreshToken")).toBeNull();
    expect(sessionStorage.getItem("googleDriveGoogleEmail")).toBeNull();
    expect(sessionStorage.getItem("driveLinkAccessToken")).toBeNull();
  });
});
