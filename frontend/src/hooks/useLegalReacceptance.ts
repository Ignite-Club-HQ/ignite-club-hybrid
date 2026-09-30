import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { resolveAuthBackend } from "@/live/authBackendMode";

/**
 * Global "users must re-read and accept Terms & Privacy Policy" switch.
 *
 * The switch lives in `app_settings` under the key `legal_reacceptance` and can
 * ONLY be changed by an app admin through the `set_legal_reacceptance` RPC,
 * which additionally requires an exact confirmation phrase. It defaults to OFF
 * and this hook fails closed to "not required": any missing row, malformed
 * payload, network error or unresolved query results in `required === false`,
 * so users can never be blocked by accident.
 */
export interface LegalReacceptanceSetting {
  required: boolean;
  version: string | null;
  effective_at: string | null;
  summary: string | null;
}

export const LEGAL_REACCEPTANCE_KEY = "legal_reacceptance";
export const LEGAL_REACCEPTANCE_CONFIRM_PHRASE = "REQUIRE ALL USERS TO REACCEPT";

function parseSetting(value: unknown): LegalReacceptanceSetting {
  const off: LegalReacceptanceSetting = {
    required: false,
    version: null,
    effective_at: null,
    summary: null,
  };
  if (!value || typeof value !== "object") return off;
  const v = value as Record<string, unknown>;
  // Only an explicit boolean `true` with a real effective date can force the gate.
  if (v.required !== true || typeof v.effective_at !== "string") return off;
  return {
    required: true,
    version: typeof v.version === "string" ? v.version : null,
    effective_at: v.effective_at,
    summary: typeof v.summary === "string" ? v.summary : null,
  };
}

export async function fetchLegalReacceptanceSetting(): Promise<LegalReacceptanceSetting> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", LEGAL_REACCEPTANCE_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseSetting(data?.value);
}

/**
 * A stable, monotonically-increasing numeric terms version for the
 * identity_access canister (which stores `terms_version: number`, not a
 * date string). The canister rejects a version lower than a previously
 * recorded one, so deriving it from `effective_at` (each activation must use
 * a later effective date than the last) keeps it monotonic for free.
 */
export function icpTermsVersionFromSetting(setting: LegalReacceptanceSetting): number {
  if (!setting.effective_at) return 0;
  const ms = new Date(setting.effective_at).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export interface UseLegalReacceptanceResult {
  /** True only when an admin enabled it AND this user hasn't accepted since. */
  mustAccept: boolean;
  setting: LegalReacceptanceSetting;
  isLoading: boolean;
  refresh: () => void;
  /** Records the current user's acceptance (Supabase RPC or ICP canister call). */
  acceptCurrentTerms: () => Promise<void>;
}

export function useLegalReacceptance(): UseLegalReacceptanceResult {
  const { user } = useAuth();
  const userId = user?.id;

  const settingQuery = useQuery({
    queryKey: ["app-setting", LEGAL_REACCEPTANCE_KEY],
    queryFn: fetchLegalReacceptanceSetting,
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const setting = settingQuery.data ?? {
    required: false,
    version: null,
    effective_at: null,
    summary: null,
  };

  // ICP-mode users are identified by their principal (never a UUID); their
  // per-user acceptance record lives in identity_access, not `profiles`.
  const isIcp = resolveAuthBackend() === "icp";

  const acceptanceQuery = useQuery({
    queryKey: ["legal-acceptance", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("terms_accepted_at, privacy_accepted_at")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    // Only ever queried when the switch is actually on (and not in ICP mode).
    enabled: !!userId && setting.required && !isIcp,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const icpAcceptanceQuery = useQuery({
    queryKey: ["legal-acceptance-icp", userId],
    queryFn: async () => {
      const { getCurrentInternetIdentity } = await import("@/live/internetIdentityAuth");
      const { fetchMyIcpTermsAcceptance } = await import("@/live/legalTerms");
      const identity = await getCurrentInternetIdentity();
      if (!identity) return null;
      return fetchMyIcpTermsAcceptance(identity);
    },
    enabled: !!userId && setting.required && isIcp,
    staleTime: 60 * 1000,
    retry: 1,
  });

  let mustAccept = false;
  if (setting.required && setting.effective_at) {
    if (isIcp) {
      if (icpAcceptanceQuery.data !== undefined) {
        const requiredVersion = icpTermsVersionFromSetting(setting);
        const acceptedVersion = icpAcceptanceQuery.data?.termsVersion ?? -1;
        mustAccept = acceptedVersion < requiredVersion;
      }
    } else if (acceptanceQuery.data !== undefined) {
      const effective = new Date(setting.effective_at).getTime();
      const terms = acceptanceQuery.data?.terms_accepted_at;
      const privacy = acceptanceQuery.data?.privacy_accepted_at;
      const acceptedAt = Math.min(
        terms ? new Date(terms).getTime() : 0,
        privacy ? new Date(privacy).getTime() : 0,
      );
      mustAccept = Number.isFinite(effective) && acceptedAt < effective;
    }
  }

  const acceptCurrentTerms = async () => {
    if (isIcp) {
      const { getCurrentInternetIdentity } = await import("@/live/internetIdentityAuth");
      const { setIcpTermsAcceptance } = await import("@/live/legalTerms");
      const identity = await getCurrentInternetIdentity();
      if (!identity) {
        throw new Error("No active Internet Identity session. Sign in again to continue.");
      }
      await setIcpTermsAcceptance(identity, icpTermsVersionFromSetting(setting));
      return;
    }
    const { error } = await supabase.rpc("accept_current_legal_terms" as never);
    if (error) throw error;
  };

  return {
    mustAccept,
    setting,
    isLoading:
      settingQuery.isPending ||
      (setting.required && (isIcp ? icpAcceptanceQuery.isPending : acceptanceQuery.isPending)),
    refresh: () => {
      void settingQuery.refetch();
      void acceptanceQuery.refetch();
      void icpAcceptanceQuery.refetch();
    },
    acceptCurrentTerms,
  };
}
