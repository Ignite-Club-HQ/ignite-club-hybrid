/** Switch-over gate for group routing. Off by default and not registered in
 * production dispatch: while inactive every club resolves to the legacy shared
 * canisters. Activation needs every gate; partial routing is never allowed. */
import { GROUP_DOMAINS } from './groupRouting';
import type { RemovalWiringEvidence } from './groupRemovalWiring';

export type ActivationGates = {
  operatorApproved: boolean; recoveryVerified: boolean; rehearsalPassed: boolean; mainnetVerified: boolean;
  routedDomains: readonly string[]; registryRevision: bigint | null; approvedRevision: bigint | null;
  /** Server-read proof that every registered group enforces removals (see groupRemovalWiring). */
  removalWiring: RemovalWiringEvidence | null;
};
export const OFF: ActivationGates = { operatorApproved: false, recoveryVerified: false, rehearsalPassed: false, mainnetVerified: false,
  routedDomains: [], registryRevision: null, approvedRevision: null, removalWiring: null };

export function activationStatus(g: ActivationGates): { active: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!g.operatorApproved) missing.push('operator approval');
  if (!g.recoveryVerified) missing.push('verified recovery');
  if (!g.rehearsalPassed) missing.push('full rehearsal');
  if (!g.mainnetVerified) missing.push('mainnet verification');
  const unrouted = GROUP_DOMAINS.filter(d => d !== 'secret_workload_identity' && !g.routedDomains.includes(d));
  if (unrouted.length) missing.push(`unrouted: ${unrouted.join(', ')}`);
  if (g.registryRevision === null || g.registryRevision !== g.approvedRevision) missing.push('approved registry revision');
  // Bound to the exact approved revision: any group added or changed afterwards invalidates it.
  if (!g.removalWiring || g.removalWiring.revision !== g.approvedRevision || g.removalWiring.groupIds.length === 0) missing.push('verified removal wiring');
  return { active: missing.length === 0, missing };
}

/** Chooses legacy or group routing for one club. Inactive => legacy, always. */
export function chooseRoute(g: ActivationGates, assigned: boolean): 'legacy' | 'group' {
  return activationStatus(g).active && assigned ? 'group' : 'legacy';
}

/** The gates this build ships with. Changing these is the switch-on step and
 * requires the club-scoped dispatcher plus every verification above. */
export const SHIPPED_GATES: ActivationGates = Object.freeze({ ...OFF });
