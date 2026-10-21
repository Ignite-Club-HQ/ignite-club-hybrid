import { activationStatus, SHIPPED_GATES } from './groupActivation';
import { hasOwnerTestRouting } from './ownerTestRouting';
import { withFeatureBackend, type FeatureBackendContext, type ClubScope } from './featureRouter';

/** Split caller-wide membership reads by their actual resource, without an
 * extra auth/dispatch round trip in the shipped, inactive configuration. */
export function readMembershipInScope<T>(
  context: FeatureBackendContext,
  scope: ClubScope,
  read: (context: FeatureBackendContext) => Promise<T>,
): Promise<T> {
  if (!activationStatus(SHIPPED_GATES).active && !hasOwnerTestRouting(context)) return read(context);
  return withFeatureBackend('membership', {
    supabase: () => { throw new Error('Internet Identity connection required'); },
    icp: read,
  }, scope);
}