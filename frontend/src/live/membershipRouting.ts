import { routingActive } from './generalActivation';
import { hasOwnerTestRouting } from './ownerTestRouting';
import { withFeatureBackend, type FeatureBackendContext, type ClubScope } from './featureRouter';

/** Split caller-wide membership reads by their actual resource, without an
 * extra auth/dispatch round trip in the shipped, inactive configuration. */
export async function readMembershipInScope<T>(
  context: FeatureBackendContext,
  scope: ClubScope,
  read: (context: FeatureBackendContext) => Promise<T>,
): Promise<T> {
  if (!await routingActive(context) && !hasOwnerTestRouting(context)) return read(context);
  return withFeatureBackend('membership', {
    supabase: () => { throw new Error('Internet Identity connection required'); },
    icp: read,
  }, scope);
}