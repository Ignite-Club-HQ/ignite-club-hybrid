import type { FeatureBackendContext } from './featureRouter';
import type { AccountRegistryBinding } from './accountAuthorityRegistry';

type Reader = (ctx: FeatureBackendContext) => Promise<AccountRegistryBinding>;
let approvedReader: Reader | undefined;

/** Deployment owner supplies independently verified evidence. No automatic
 * source, localStorage, membership inference, self-approved registry or flags. */
export function registerPrivateProfileEvidenceReader(reader: Reader): () => void {
  approvedReader = reader;
  return () => { if (approvedReader === reader) approvedReader = undefined; };
}

export async function readPrivateProfileEvidence(ctx: FeatureBackendContext, supplied?: AccountRegistryBinding): Promise<AccountRegistryBinding | undefined> {
  const reader = approvedReader;
  if (!supplied && !reader) return undefined; // Explicit disposable rehearsal only.
  const identity = ctx.identity;
  const principal = identity.getPrincipal().toText();
  const target = JSON.stringify(ctx.target);
  const binding = supplied ?? await reader?.(ctx);
  if (!binding || ctx.identity !== identity || identity.getPrincipal().toText() !== principal || JSON.stringify(ctx.target) !== target || (!supplied && approvedReader !== reader)) throw new Error('Private-profile deployment evidence changed.');
  if (binding.targetAlias !== ctx.target.alias || binding.host !== ctx.target.host || binding.networkKind !== ctx.target.networkKind
      || !binding.deploymentId || binding.deploymentRevision < 1n || binding.registryRevision < 1n
      || !binding.requiredClubAuthorities.length || new Set(binding.requiredClubAuthorities).size !== binding.requiredClubAuthorities.length
      || !binding.host.startsWith('https://') || new URL(binding.host).origin !== binding.host) throw new Error('Verified private-profile deployment evidence is required.');
  return { ...binding, requiredClubAuthorities: [...binding.requiredClubAuthorities] };
}