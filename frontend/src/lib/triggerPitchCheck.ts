/**
 * Fires the `check-pending-subs` edge function immediately so push fan-out
 * to other staff happens within ~1s instead of waiting for the next 10s
 * cron cycle. Critical for pending-sub notifications because the open pitch
 * board executes subs quickly, marking them executed before cron sees them.
 */
import { supabase } from "@/integrations/supabase/client";

const recent = new Map<string, number>();
const DEDUPE_MS = 4000;

export async function triggerPitchCheck(source: string, dedupeKey?: string): Promise<void> {
  const now = Date.now();
  if (dedupeKey) {
    const last = recent.get(dedupeKey);
    if (last && now - last < DEDUPE_MS) return;
    recent.set(dedupeKey, now);
    // light garbage collect
    if (recent.size > 50) {
      for (const [k, t] of recent.entries()) {
        if (now - t > DEDUPE_MS * 4) recent.delete(k);
      }
    }
  }

  try {
    await supabase.functions.invoke("check-pending-subs", { body: { source } });
  } catch (err) {
    console.warn("[triggerPitchCheck] failed", err);
  }
}
