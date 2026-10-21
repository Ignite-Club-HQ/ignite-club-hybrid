import type { FeatureBackendContext } from './featureRouter';
import { writeOnce } from './clubScope';
import { hasOwnerTestRouting } from './ownerTestRouting';
export async function writeEoiInScope<T>(fallback: FeatureBackendContext, id: string, action: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> {
  const { activationStatus, SHIPPED_GATES } = await import('./groupActivation');
  if (!activationStatus(SHIPPED_GATES).active && !hasOwnerTestRouting(fallback)) return action(fallback);
  const { withFeatureBackend } = await import('./featureRouter');
  return withFeatureBackend('competitions', { supabase: () => { throw new Error('ICP EOI routing required'); }, icp: action }, writeOnce({ eoiId: id }));
}