import { supabase } from "@/integrations/supabase/client";
import {
  ICP_CANISTER_CONFIG_KEY,
  applyIcpAdminOverrides,
  parseIcpAdminOverrides,
} from "./icpAdminOverrides";
import { readLiveAppConfig } from "./appConfig";
import { isSignedInWithEmail, hasStoredInternetIdentitySession } from "./loadBackendRouting";
import { shouldBootstrapFromIcp } from "./icpBootstrap";

/**
 * Loads the app-admin ICP canister configuration from `public.app_settings`
 * and applies it to the runtime override store. Failures are non-fatal: the
 * app falls back to the build-time `IGNITE_LIVE_ICP_CANISTER_IDS_JSON` values.
 *
 * Kept separate from `icpAdminOverrides.ts` because that module is imported by
 * `targetRegistry.ts`, which the Supabase live client itself imports — the
 * Supabase import must not live on that path (module cycle).
 */
export async function loadIcpAdminOverrides(): Promise<void> {
  try {
    if ((!isSignedInWithEmail() && hasStoredInternetIdentitySession()) || shouldBootstrapFromIcp()) {
      const raw = await readLiveAppConfig(ICP_CANISTER_CONFIG_KEY);
      // The anonymous helper returns null on outage as well as absence. Keep
      // an applied target on ambiguous reads; an explicit empty object clears.
      if (raw !== null) applyIcpAdminOverrides(await parseIcpAdminOverrides(JSON.parse(raw)));
      return;
    }
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", ICP_CANISTER_CONFIG_KEY)
      .maybeSingle();
    if (error) throw error;
    applyIcpAdminOverrides(data ? await parseIcpAdminOverrides(data.value) : null);
  } catch (error) {
    console.warn(
      "[icp] Could not load admin canister overrides; using build-time configuration.",
      error,
    );
  }
}
