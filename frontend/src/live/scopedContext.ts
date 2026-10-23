/** Contexts handed to one leg of a cross-group fan-out (shared canisters or a
 * single group). Caller-wide helpers called inside such a leg must read only
 * that leg's canister; fanning out again would return other groups' clubs and
 * then fail looking them up on the wrong canister (empty My Clubs). */
const scoped = new WeakSet<object>();
export function markScopedContext<T extends object>(ctx: T): T {
  // Scope belongs to this callback, never to the session's reusable context.
  const leg = { ...ctx };
  scoped.add(leg);
  return leg;
}
export function isScopedContext(ctx: unknown): boolean { return typeof ctx === 'object' && ctx !== null && scoped.has(ctx); }
