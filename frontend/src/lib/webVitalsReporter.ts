import { onCLS, onLCP, onTTFB, onINP, type Metric } from "web-vitals";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lightweight Web Vitals reporter that logs Core Web Vitals to Supabase.
 * Metrics captured: LCP, FID, CLS, TTFB, INP
 * 
 * Each metric is sent once per page load (web-vitals library handles this).
 * We sample at 100% by default — adjust SAMPLE_RATE to reduce volume.
 */

const SAMPLE_RATE = 0.25; // Log 25% of page loads to keep volume manageable

let shouldSample: boolean | null = null;

function getShouldSample(): boolean {
  if (shouldSample === null) {
    shouldSample = Math.random() < SAMPLE_RATE;
  }
  return shouldSample;
}

function getConnectionType(): string | null {
  const nav = navigator as any;
  return nav.connection?.effectiveType ?? null;
}

function getDeviceMemory(): number | null {
  const nav = navigator as any;
  return nav.deviceMemory ?? null;
}

async function sendMetric(metric: Metric) {
  if (!getShouldSample()) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();

    await supabase.from("web_vitals").insert({
      user_id: session?.user?.id ?? null,
      metric_name: metric.name,
      metric_value: Math.round(metric.value * 100) / 100,
      rating: metric.rating, // "good" | "needs-improvement" | "poor"
      page_path: window.location.pathname,
      user_agent: navigator.userAgent.substring(0, 255),
      connection_type: getConnectionType(),
      device_memory: getDeviceMemory(),
    });
  } catch (e) {
    // Silently fail — never impact user experience for analytics
    console.debug("[WebVitals] Failed to report metric:", e);
  }
}

export function initWebVitalsReporter() {
  // Skip in development and native apps
  const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
  if (isNative) return;

  onLCP(sendMetric);
  onCLS(sendMetric);
  onTTFB(sendMetric);
  onINP(sendMetric);
}
