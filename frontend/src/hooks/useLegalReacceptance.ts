import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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

export interface UseLegalReacceptanceResult {
  /** True only when an admin enabled it AND this user hasn't accepted since. */
  mustAccept: boolean;
  setting: LegalReacceptanceSetting;
  isLoading: boolean;
  refresh: () => void;
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
    // Only ever queried when the switch is actually on.
    enabled: !!userId && setting.required,
    staleTime: 60 * 1000,
    retry: 1,
  });

  let mustAccept = false;
  if (setting.required && setting.effective_at && acceptanceQuery.data !== undefined) {
    const effective = new Date(setting.effective_at).getTime();
    const terms = acceptanceQuery.data?.terms_accepted_at;
    const privacy = acceptanceQuery.data?.privacy_accepted_at;
    const acceptedAt = Math.min(
      terms ? new Date(terms).getTime() : 0,
      privacy ? new Date(privacy).getTime() : 0,
    );
    mustAccept = Number.isFinite(effective) && acceptedAt < effective;
  }

  return {
    mustAccept,
    setting,
    isLoading: settingQuery.isPending || (setting.required && acceptanceQuery.isPending),
    refresh: () => {
      void settingQuery.refetch();
      void acceptanceQuery.refetch();
    },
  };
}
