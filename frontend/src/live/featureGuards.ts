import { isFeatureRoutedToIcp } from "./loadBackendRouting";
import type { FeatureArea } from "./featureBackend";

/**
 * Throws when `feature` is routed to the ICP backend, so Supabase-only write
 * paths that have no canister counterpart yet cannot silently run against
 * (and corrupt/skip) a user's ICP-side data. Callers should catch this the
 * same way they catch any other mutation error (existing onError/toast
 * handling) and the call site should carry a `NEEDS-CANISTER: <...>` comment
 * describing the canister method that would be needed to lift the gate.
 */
export function assertSupabaseWritePath(feature: FeatureArea, whatNeeded: string): void {
  if (isFeatureRoutedToIcp(feature)) {
    throw new Error(
      `This action is not available yet for Internet Identity accounts (${whatNeeded}).`,
    );
  }
}
