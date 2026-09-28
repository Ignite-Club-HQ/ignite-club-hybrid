import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;

const DRIVE_IMPORT_ALLOWED_CLUB_IDS = new Set<string>([
  "966bdaec-ebf1-46da-b2b3-cc53bf05c422",
  "493ee2e3-c834-487d-93be-d1c8a0dbc4a8",
  "36231b76-5313-478e-b8d5-23ac4f5e8b10",
]);

export function isVaultDriveEnabled(clubId: string | null | undefined): boolean {
  return !!clubId && DRIVE_IMPORT_ALLOWED_CLUB_IDS.has(clubId);
}

export interface VaultDriveTitleSummary {
  scanned: number;
  updated: number;
  unresolved: number;
  errors: number;
  hasOAuth?: boolean;
}

export async function resolveVaultDriveTitles(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultDriveTitleSummary | undefined> {
  const { data, error } = await client.functions.invoke("resolve-drive-titles", {
    body: { clubId },
  });
  if (error) throw error;
  return (data as { summary?: VaultDriveTitleSummary } | null)?.summary;
}

export function getVaultDriveRedirectUri(isNative: boolean, webOrigin: string): string {
  return isNative ? "https://igniteclubhq.app/vault" : `${webOrigin}/vault`;
}

export interface VaultDriveOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  googleEmail?: string;
}

export async function exchangeVaultDriveOAuthCode(
  options: { code: string; redirectUri: string },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultDriveOAuthTokens> {
  const { data, error } = await client.functions.invoke(
    "google-drive-import?action=exchange-code",
    { body: options },
  );
  const payload = data as (VaultDriveOAuthTokens & { error?: string }) | null;
  if (error || payload?.error || !payload?.accessToken) {
    throw new Error(payload?.error || error?.message || "Failed to exchange Google Drive code");
  }
  return payload;
}

export interface VaultDriveSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function storeVaultDriveOAuthTokens(
  tokens: VaultDriveOAuthTokens,
  storage: VaultDriveSessionStorage,
): "link" | "import" {
  if (storage.getItem("driveLinkPending")) {
    storage.removeItem("driveLinkPending");
    storage.setItem("driveLinkAccessToken", tokens.accessToken);
    if (tokens.refreshToken) storage.setItem("driveLinkRefreshToken", tokens.refreshToken);
    if (tokens.googleEmail) storage.setItem("driveLinkGoogleEmail", tokens.googleEmail);
    return "link";
  }

  storage.setItem("googleDriveAccessToken", tokens.accessToken);
  if (tokens.refreshToken) storage.setItem("googleDriveRefreshToken", tokens.refreshToken);
  if (tokens.googleEmail) storage.setItem("googleDriveGoogleEmail", tokens.googleEmail);
  return "import";
}
