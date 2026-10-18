/** Mark a club-scoped call as a write that is never retried automatically
 * (most canister writes have no idempotency key). Kept apart from
 * featureRouter so call sites don't depend on the router module's shape. */
export function writeOnce<S extends object>(scope: S): S & { writeKey: string; attempts: 1 } {
  return { ...scope, writeKey: "once", attempts: 1 };
}
