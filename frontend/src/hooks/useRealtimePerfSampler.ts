import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getPlatform } from "@/lib/nativePush";

/**
 * Lightweight realtime latency sampler.
 *
 * Subscribes to `notifications` (for this user) and `message_reads` (global)
 * and records `received_at - row.created_at/read_at` into
 * `realtime_perf_samples`. Samples are batched and flushed every 30s to avoid
 * write amplification on the very tables we're measuring.
 *
 * Only one user in N samples to keep cost negligible.
 */
const SAMPLE_RATE = 0.1; // 10% of received events
const FLUSH_MS = 30_000;

type Pending = {
  channel: string;
  event: string;
  latency_ms: number;
  sent_at: string;
};

export function useRealtimePerfSampler(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    // Stable per-session sampling decision
    if (Math.random() > SAMPLE_RATE) return;

    const platform = (() => {
      try { return getPlatform(); } catch { return "web"; }
    })();
    const pending: Pending[] = [];

    const record = (channel: string, event: string, sentIso: string | null | undefined) => {
      if (!sentIso) return;
      const sentMs = Date.parse(sentIso);
      if (!Number.isFinite(sentMs)) return;
      const latency = Date.now() - sentMs;
      // Discard obviously-bogus clock skew
      if (latency < 0 || latency > 120_000) return;
      pending.push({
        channel,
        event,
        latency_ms: Math.round(latency),
        sent_at: sentIso,
      });
    };

    const notifChan = supabase
      .channel(`perf-notif-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => record("notifications", "INSERT", (payload.new as any)?.created_at),
      )
      .subscribe();

    const readsChan = supabase
      .channel("perf-message-reads")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reads" },
        (payload) => record("message_reads", "INSERT", (payload.new as any)?.read_at),
      )
      .subscribe();

    const flush = async () => {
      if (!pending.length) return;
      const batch = pending.splice(0, pending.length).map((p) => ({
        ...p,
        user_id: userId,
        platform,
      }));
      try {
        await supabase.from("realtime_perf_samples").insert(batch);
      } catch {
        // swallow; perf sampling must never crash the app
      }
    };

    const flushTimer = window.setInterval(flush, FLUSH_MS);
    const onHide = () => { void flush(); };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      window.clearInterval(flushTimer);
      document.removeEventListener("visibilitychange", onHide);
      void flush();
      void supabase.removeChannel(notifChan);
      void supabase.removeChannel(readsChan);
    };
  }, [userId]);
}
