/** Capacity policy over operator-verified, deployment-bound observations.
 * Plans closed preparation only; it never authorizes opening or migration. */
export const PREPARE_PERCENT = 70;
export const ROLLOVER_PERCENT = 80;
export const CAPACITY_READING_MAX_AGE_MS = 15 * 60 * 1000;

export type CapacityReading = { resource: string; used: number; testedLimit: number; evidence: string };
export type CapacityEvidence = {
  deploymentId: string; observedAtMs: number; readings: CapacityReading[];
  /** Complete expected set, including storage, processing and club admission. */
  requiredResources: string[];
};

export function capacityPercent(e: CapacityEvidence | undefined, deploymentId: string, now: number): number | null {
  if (!e || e.deploymentId !== deploymentId || !Number.isFinite(now) ||
    !Number.isFinite(e.observedAtMs) || e.observedAtMs > now || now - e.observedAtMs > CAPACITY_READING_MAX_AGE_MS ||
    !e.requiredResources.length || !e.readings.length) return null;
  const names = new Set(e.readings.map(r => r.resource));
  if (names.size !== e.readings.length || new Set(e.requiredResources).size !== e.requiredResources.length ||
    names.size !== e.requiredResources.length || e.requiredResources.some(r => !names.has(r))) return null;
  if (e.readings.some(r => !r.resource.trim() || !r.evidence.trim() || !Number.isFinite(r.used) || r.used < 0 ||
    !Number.isFinite(r.testedLimit) || r.testedLimit <= 0)) return null;
  return Math.max(...e.readings.map(r => r.used / r.testedLimit * 100));
}

export function capacityState(percent: number | null): 'unknown' | 'ok' | 'watch' | 'act' {
  if (percent === null) return 'unknown';
  if (percent >= ROLLOVER_PERCENT) return 'act';
  return percent >= PREPARE_PERCENT ? 'watch' : 'ok';
}