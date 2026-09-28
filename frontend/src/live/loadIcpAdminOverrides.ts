import { supabase } from "@/integrations/supabase/client";
import {
  ICP_CANISTER_CONFIG_KEY,
  applyIcpAdminOverrides,
  parseIcpAdminOverrides,
} from "./icpAdminOverrides";

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
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", ICP_CANISTER_CONFIG_KEY)
      .maybeSingle();
    if (error) throw error;
    applyIcpAdminOverrides(data ? parseIcpAdminOverrides(data.value) : null);
  } catch (error) {
    console.warn(
      "[icp] Could not load admin canister overrides; using build-time configuration.",
      error,
    );
  }
}
