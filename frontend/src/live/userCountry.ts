import { isValidCountryCode } from "@/lib/countries";

/**
 * Resolves the current user's country for backend routing.
 *
 * Two sources, in priority order:
 * 1. The `country` field on the user's profile (set in Edit Profile) —
 *    supplied via `setProfileCountry`.
 * 2. IP geolocation via https://api.country.is (no API key, returns only a
 *    country code), cached in sessionStorage for the tab's lifetime.
 *
 * Everything is best-effort: failures leave the country unknown, and the
 * backend resolver treats an unknown country as eligible for both backends.
 */

const IP_COUNTRY_CACHE_KEY = "ignite_ip_country";

let profileCountry: string | null = null;
let detectedCountry: string | null = readCachedIpCountry();

function normalize(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const normalized = code.trim().toUpperCase();
  return isValidCountryCode(normalized) ? normalized : null;
}

function readCachedIpCountry(): string | null {
  try {
    return normalize(sessionStorage.getItem(IP_COUNTRY_CACHE_KEY));
  } catch {
    return null;
  }
}

export function setProfileCountry(code: string | null | undefined): void {
  profileCountry = normalize(code) ?? null;
}

export type CurrentCountry = {
  country: string | null;
  source: "profile" | "ip" | "unknown";
};

export function getCurrentCountry(): CurrentCountry {
  if (profileCountry) return { country: profileCountry, source: "profile" };
  if (detectedCountry) return { country: detectedCountry, source: "ip" };
  return { country: null, source: "unknown" };
}

export async function detectCountryByIp(): Promise<string | null> {
  if (detectedCountry) return detectedCountry;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch("https://api.country.is", { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const body = (await response.json()) as { country?: unknown };
    const code = normalize(body.country);
    if (!code) return null;
    detectedCountry = code;
    try {
      sessionStorage.setItem(IP_COUNTRY_CACHE_KEY, code);
    } catch {
      // Storage unavailable (private mode) — keep the in-memory value only.
    }
    return code;
  } catch {
    return null;
  }
}
