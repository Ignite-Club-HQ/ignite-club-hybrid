import type { ClubScope, FeatureArea, FeatureBackendContext } from './contentRoutingTypes';
import { activationStatus, SHIPPED_GATES } from './groupActivation';

/** Composite feeds route each nested resource separately, never their whole context. */
export async function readContentInScope<T>(ctx: FeatureBackendContext, feature: FeatureArea, scope: ClubScope, read: (context: FeatureBackendContext) => Promise<T>): Promise<T> {
  if (!activationStatus(SHIPPED_GATES).active) return read(ctx);
  const { withFeatureBackend } = await import('./featureRouter');
  return withFeatureBackend(feature, { supabase: () => { throw new Error('ICP content read cannot fall back'); }, icp: read }, scope);
}