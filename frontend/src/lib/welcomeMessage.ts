import { supabase } from "@/integrations/supabase/client";

export const WELCOME_DM_SETTING_KEY = "welcome_dm_message";

export const DEFAULT_WELCOME_DM_MESSAGE =
  "Welcome to Ignite! I'm here if you need a hand getting your club set up — just reply to this message any time.";

/**
 * Reads the app-admin-configurable welcome DM text from the global
 * `app_settings` table (key `welcome_dm_message`). This is global app
 * config with no user/club scope, so it is read for both Supabase and
 * Internet Identity sessions (same precedent as the backend-routing
 * overrides). Falls back to the default text on any error or missing
 * value — the welcome DM must never fail because of a settings read.
 */
export async function fetchWelcomeDmMessage(): Promise<string> {
  try {
    const { data: row } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", WELCOME_DM_SETTING_KEY)
      .maybeSingle();
    const raw = row?.value;
    const text =
      typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_WELCOME_DM_MESSAGE;
  } catch {
    return DEFAULT_WELCOME_DM_MESSAGE;
  }
}
