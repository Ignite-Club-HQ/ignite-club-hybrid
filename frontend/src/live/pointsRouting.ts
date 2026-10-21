import { routingActive } from './generalActivation';
import { hasOwnerTestRouting } from './ownerTestRouting';
import { withFeatureBackend, type FeatureBackendContext } from './featureRouter';

/** Caller-wide reward helpers must resolve each club independently. */
export async function readPointsInClub<T>(
  context: FeatureBackendContext,
  clubId: string,
  read: (context: FeatureBackendContext) => Promise<T>,
): Promise<T> {
  if (!clubId) return Promise.reject(new Error('Reward club is missing'));
  if (!await routingActive(context) && !hasOwnerTestRouting(context)) return read(context);
  return withFeatureBackend('points', {
    supabase: () => { throw new Error('Internet Identity connection required'); },
    icp: read,
  }, { clubId });
}