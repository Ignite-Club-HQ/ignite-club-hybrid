/**
 * Module-cached kill-switch for the "warm chat chunk on push receive"
 * performance optimisation. Sync getter (`isNotificationPrefetchEnabled`) so
 * the native push receive handler — which must not `await` before returning
 * to the OS — can gate cheaply.
 *
 * Sources of truth:
 *   - `public.app_settings.notification_prefetch_enabled` (jsonb boolean)
 *   - Default: TRUE (perf on) if row missing / fetch failed.
 *
 * Lifecycle: `initNotificationPrefetchFlag()` at app boot fires a one-shot
 * fetch and subscribes to realtime UPDATEs on the row so a toggle in
 * /admin/settings propagates within ~1s. Cached value survives across all
 * push events for the session.
 */
import { supabase } from "@/integrations/supabase/client";

let cachedEnabled: boolean = true; // safe default: perf on
let initialized = false;

export function isNotificationPrefetchEnabled(): boolean {
  return cachedEnabled;
}

async function refresh(): Promise<void> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "notification_prefetch_enabled")
      .maybeSingle();
    if (data) {
      cachedEnabled = data.value !== false && data.value !== "false";
    }
  } catch {
    // Keep last known value.
  }
}

export function initNotificationPrefetchFlag(): void {
  if (initialized) return;
  initialized = true;
  void refresh();
  try {
    supabase
      .channel("app-settings-notification-prefetch")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_settings",
          filter: "key=eq.notification_prefetch_enabled",
        },
        () => { void refresh(); },
      )
      .subscribe();
  } catch {
    // Realtime not critical — the one-shot fetch above is enough.
  }
}
