import { onCLS, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { telemetry } from "./telemetry";

function connectionType(): string | null {
  if (typeof navigator === "undefined") {
    return null;
  }
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string };
  }).connection;
  return connection?.effectiveType ?? null;
}

function report(metric: Metric): void {
  telemetry.record(
    `web_vital.${metric.name.toLowerCase()}`,
    {
      rating: metric.rating,
      path: typeof window === "undefined" ? null : window.location.pathname,
      connection_type: connectionType(),
    },
    Math.round(metric.value * 100) / 100,
  );
}

export function initWebVitalsTelemetry(): void {
  if (typeof window === "undefined") {
    return;
  }
  onCLS(report);
  onLCP(report);
  onTTFB(report);
  onINP(report);
}
