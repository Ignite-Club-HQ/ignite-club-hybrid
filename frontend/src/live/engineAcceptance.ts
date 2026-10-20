/** Caller-supplied evidence collector, NOT an independent verifier or activation gate. Offline evidence never becomes
 * real-engine acceptance, and no result can register, route or open a group. */
import { ENGINE_INSTALL_SERVICES } from './engineClosedInstall';
import { CAPACITY_READING_MAX_AGE_MS } from './groupCapacityPolicy';
import { Principal } from '@icp-sdk/core/principal';

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
export const MAX_ENGINE_EVIDENCE_BYTES = 16_384;
export type EngineEvidenceRecord = {
  schema: 1; source: 'fixture' | 'engine-capture';
  canisterIds: EngineAcceptanceScope['canisterIds'];
  /** Receipt locator only, not cryptographic proof; never include secrets or PII. */
  receipt: string; assertions: { name: string; expected: string; observed: string }[];
};
export type EngineCheckEvidence = { check: EngineAcceptanceCheck; binding: string; registryRevision: bigint; observedAtMs: number; passed: boolean; evidence: string; record: EngineEvidenceRecord };

function validRecord(e: EngineCheckEvidence, scope: EngineAcceptanceScope) {
  const r = e.record;
  if (!r || r.schema !== 1 || r.source !== (scope.mode === 'offline' ? 'fixture' : 'engine-capture') ||
      typeof r.receipt !== 'string' || !r.receipt.trim() || r.receipt.length > 512 ||
      !Array.isArray(r.assertions) || r.assertions.length < 1 || r.assertions.length > 32 ||
      !r.canisterIds || Object.keys(r.canisterIds).length !== ENGINE_INSTALL_SERVICES.length ||
      ENGINE_INSTALL_SERVICES.some(d => r.canisterIds[d] !== scope.canisterIds[d])) return false;
  const names = new Set<string>();
  for (const a of r.assertions) {
    if (!a || typeof a.name !== 'string' || !a.name.trim() || names.has(a.name) || a.name.length > 128 ||
        typeof a.expected !== 'string' || !a.expected.trim() || a.expected.length > 2048 ||
        typeof a.observed !== 'string' || a.observed !== a.expected) return false;
    names.add(a.name);
  }
  return new TextEncoder().encode(JSON.stringify(r)).length <= MAX_ENGINE_EVIDENCE_BYTES;
}

export async function collectEngineAcceptance(scope: EngineAcceptanceScope, now: number,
  probe: (check: EngineAcceptanceCheck, scope: EngineAcceptanceScope) => Promise<EngineCheckEvidence>) {
  if (!['offline', 'real-engine'].includes(scope.mode) || !scope.binding.trim() || scope.registryRevision < 1n || !Number.isSafeInteger(now) || now < 0) throw new Error('Exact acceptance binding required');
  const ids = ENGINE_INSTALL_SERVICES.map(d => scope.canisterIds[d]);
  if (ids.some(id => !id?.trim()) || new Set(ids).size !== ids.length || Object.keys(scope.canisterIds).length !== ids.length) throw new Error('Complete unique engine inventory required');
  for (const id of ids) {
    const p = Principal.fromText(id);
    if (p.isAnonymous() || p.toText() === 'aaaaa-aa' || p.toText() !== id) throw new Error('Exact engine principal required');
  }
  // Neither probes nor later caller edits can change the collection's identity.
  const snapshot = Object.freeze({ ...scope, canisterIds: Object.freeze({ ...scope.canisterIds }) });
  const results: EngineCheckEvidence[] = [];
  const missing: EngineAcceptanceCheck[] = [];
  for (const check of ENGINE_ACCEPTANCE_CHECKS) {
    try {
      const e = await probe(check, snapshot);
      if (e.check !== check || e.binding !== snapshot.binding || e.registryRevision !== snapshot.registryRevision ||
          !Number.isSafeInteger(e.observedAtMs) || e.observedAtMs < 0 || e.observedAtMs > now || now - e.observedAtMs > CAPACITY_READING_MAX_AGE_MS ||
          typeof e.evidence !== 'string' || !e.evidence.trim() || new TextEncoder().encode(e.evidence).length > MAX_ENGINE_EVIDENCE_BYTES || e.passed !== true || !validRecord(e, snapshot)) {
        missing.push(check); continue;
      }
      results.push(structuredClone(e));
    } catch { missing.push(check); }
  }
  return { mode: snapshot.mode, binding: snapshot.binding, registryRevision: snapshot.registryRevision, results, missing,
    offlinePassed: snapshot.mode === 'offline' && missing.length === 0,
    /** Even complete real-engine evidence requires external validation and owner release. */
    activationAuthorized: false as const,
    independentlyVerified: false as const,
    realEngineVerificationRequired: true as const };
}