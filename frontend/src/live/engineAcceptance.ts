/** Evidence collector, NOT an activation gate. Offline evidence never becomes
 * real-engine acceptance, and no result can register, route or open a group. */
import { ENGINE_INSTALL_SERVICES } from './engineClosedInstall';
import { CAPACITY_READING_MAX_AGE_MS } from './groupCapacityPolicy';

export const ENGINE_ACCEPTANCE_CHECKS = [
  'console-identity-and-certificate', 'complete-service-wiring', 'immutable-new-club-placement',
  'gallery-encrypted-readback', 'chat-attachment-readback', 'vault-staff-readback',
  'pending-upload-upgrade-recovery', 'removed-member-denial', 'retained-other-club-access',
  'notification-audience-and-device-delivery', 'timer-execution', 'direct-http-outcall',
  'engine-to-mainnet-bounded-cycle-free', 'mainnet-to-engine-bounded-cycle-free',
  'proxy-vetkd-and-key-continuity', 'unknown-outcome-no-replay', 'capacity-and-billing-runway',
  'browser-sign-in-continuity', 'native-sign-in-continuity',
] as const;
export type EngineAcceptanceCheck = typeof ENGINE_ACCEPTANCE_CHECKS[number];
export type EngineAcceptanceScope = {
  mode: 'offline' | 'real-engine'; binding: string; registryRevision: bigint;
  canisterIds: Record<typeof ENGINE_INSTALL_SERVICES[number], string>;
};
export type EngineCheckEvidence = { check: EngineAcceptanceCheck; binding: string; registryRevision: bigint; observedAtMs: number; passed: boolean; evidence: string };

export async function collectEngineAcceptance(scope: EngineAcceptanceScope, now: number,
  probe: (check: EngineAcceptanceCheck, scope: EngineAcceptanceScope) => Promise<EngineCheckEvidence>) {
  if (!scope.binding.trim() || scope.registryRevision < 1n || !Number.isFinite(now)) throw new Error('Exact acceptance binding required');
  const ids = ENGINE_INSTALL_SERVICES.map(d => scope.canisterIds[d]);
  if (ids.some(id => !id?.trim()) || new Set(ids).size !== ids.length) throw new Error('Complete unique engine inventory required');
  const results: EngineCheckEvidence[] = [];
  const missing: EngineAcceptanceCheck[] = [];
  for (const check of ENGINE_ACCEPTANCE_CHECKS) {
    try {
      const e = await probe(check, scope);
      if (e.check !== check || e.binding !== scope.binding || e.registryRevision !== scope.registryRevision ||
          !Number.isFinite(e.observedAtMs) || e.observedAtMs > now || now - e.observedAtMs > CAPACITY_READING_MAX_AGE_MS || !e.evidence.trim() || e.passed !== true) {
        missing.push(check); continue;
      }
      results.push(e);
    } catch { missing.push(check); }
  }
  return { mode: scope.mode, binding: scope.binding, results, missing,
    offlinePassed: scope.mode === 'offline' && missing.length === 0,
    /** Even complete real-engine evidence requires external validation and owner release. */
    activationAuthorized: false as const,
    realEngineVerificationRequired: scope.mode === 'offline' };
}