/** Offline rental/backup assessment only. No console reads, alerts or release authority. */
export type EngineSafetyPolicy = {
  warningRunwayMs: number; urgentRunwayMs: number; maxReadingAgeMs: number;
  maxBackupAgeMs: number; maxRestoreDrillAgeMs: number;
};
export type EngineSafetyReading = {
  binding: string; observedAtMs: number; paidThroughMs: number;
  serviceRunning: boolean; automaticPayment: 'healthy' | 'failed' | 'unknown';
  backupAtMs: number; restoreDrillAtMs: number; backupBinding: string;
  encryptedMediaRecoverable: boolean;
};
export function assessEngineOperationalSafety(binding: string, now: number, p: EngineSafetyPolicy, r: EngineSafetyReading) {
  if (!binding.trim() || !Number.isSafeInteger(now) || now < 0 ||
      Object.values(p).some(v => !Number.isSafeInteger(v) || v <= 0) || p.warningRunwayMs <= p.urgentRunwayMs) {
    throw new Error('Explicit rental and recovery policy required');
  }
  const fresh = (t: number, age: number) => Number.isSafeInteger(t) && t >= 0 && t <= now && now - t <= age;
  const reasons: string[] = [];
  if (r.binding !== binding || !fresh(r.observedAtMs, p.maxReadingAgeMs)) reasons.push('untrusted-or-stale-reading');
  const validPaidThrough = Number.isSafeInteger(r.paidThroughMs) && r.paidThroughMs >= 0;
  const runwayMs = validPaidThrough ? Math.max(0, r.paidThroughMs - now) : 0;
  if (!validPaidThrough || runwayMs <= p.urgentRunwayMs) reasons.push('urgent-rental-runway');
  else if (runwayMs <= p.warningRunwayMs) reasons.push('warning-rental-runway');
  if (r.serviceRunning !== true) reasons.push('service-not-running');
  if (r.automaticPayment !== 'healthy') reasons.push('payment-needs-attention');
  if (r.backupBinding !== binding || !fresh(r.backupAtMs, p.maxBackupAgeMs)) reasons.push('backup-missing-or-stale');
  if (!fresh(r.restoreDrillAtMs, p.maxRestoreDrillAgeMs) || r.restoreDrillAtMs < r.backupAtMs || r.encryptedMediaRecoverable !== true) reasons.push('recovery-not-demonstrated');
  return { runwayMs, reasons, offlinePolicySatisfied: reasons.length === 0,
    activationAuthorized: false as const, independentlyVerified: false as const };
}