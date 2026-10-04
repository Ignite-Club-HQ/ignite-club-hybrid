import type { FeatureBackendContext } from "../featureRouter";
import { connectLiveClubDomain } from "../domains";
import { unwrapCandid } from "./candid";

/**
 * Live (ICP) counterpart of the global `public.app_settings` rows that are
 * backend-agnostic app configuration. Values are stored on club_domain's
 * app_config key/value store as JSON-encoded text (same shape as the
 * Supabase jsonb `value` column, so `true`, `100` and `"text"` round-trip
 * identically on both backends).
 *
 * Reads go through the canister's public anonymous query (see
 * live/appConfig.ts `readLiveAppConfig` for the pre-auth/boot variant); the
 * functions here use the caller's authenticated actor. Writes require the
 * governor or an app-admin role on club_domain — enforced canister-side.
 */

export async function getLiveAppSetting(
  ctx: FeatureBackendContext,
  key: string,
): Promise<string | null> {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  const value = await actor.get_app_config(key);
  return value.length ? value[0] : null;
}

export async function setLiveAppSetting(
  ctx: FeatureBackendContext,
  key: string,
  value: unknown,
): Promise<void> {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_app_config(key, JSON.stringify(value)),
    "Set app setting",
  );
}

/** Parse a stored app_config value as a boolean, falling back when unset/invalid. */
export function decodeAppSettingBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === true || parsed === "true";
  } catch {
    return fallback;
  }
}

/** Parse a stored app_config value as a finite number, falling back when unset/invalid. */
export function decodeAppSettingNumber(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  try {
    const n = Number(JSON.parse(raw));
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Parse a stored app_config value as a trimmed string, falling back when unset/empty. */
export function decodeAppSettingString(raw: string | null, fallback: string): string {
  if (raw == null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    const text = typeof parsed === "string" ? parsed : parsed == null ? "" : String(parsed);
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  } catch {
    return fallback;
  }
}
