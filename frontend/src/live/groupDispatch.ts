/** Club-scoped dispatcher: the single place app features ask "which canisters
 * serve this club?". While the switch-on lock is off (this build) every call
 * goes through withFeatureBackend to the shared canisters exactly as before.
 * When switched on, one group session per signed-in principal routes each club
 * to its assigned group; a club with no assignment stays on the shared
 * canisters (not yet moved). Never falls back from a group to the old canisters. */
import type { FeatureArea } from './featureBackend';
import type { FeatureBackendContext } from './featureRouter';
import type { GroupDomain } from './groupRouting';
import { activationStatus, chooseRoute, SHIPPED_GATES, type ActivationGates } from './groupActivation';

type Session = { readClub<T>(c: string, d: GroupDomain, r: (ctx: FeatureBackendContext) => Promise<T>): Promise<T>;
  writeClub<T>(c: string, d: GroupDomain, k: string, w: (ctx: FeatureBackendContext, k: string) => Promise<T>, attempts?: number): Promise<T>;
  isAssigned(c: string): boolean; dispose(): void };
export type DispatchDeps = {
  gates: () => ActivationGates;
  legacy: <T>(feature: FeatureArea, clubId: string, icp: (ctx: FeatureBackendContext) => Promise<T>) => Promise<T>;
  context: () => Promise<FeatureBackendContext>;
  open: (ctx: FeatureBackendContext) => Promise<Session>;
};
let cached: { principal: string; session: Promise<Session> } | null = null;
export function clearGroupDispatchCache() { cached?.session.then(s => s.dispose(), () => {}); cached = null; }

async function sessionFor(deps: DispatchDeps): Promise<{ ctx: FeatureBackendContext; s: Session }> {
  const ctx = await deps.context(); const principal = ctx.identity.getPrincipal().toText();
  if (!cached || cached.principal !== principal) { clearGroupDispatchCache(); cached = { principal, session: deps.open(ctx) }; }
  try { return { ctx, s: await cached.session }; } catch (e) { cached = null; throw e; }
}

export function createClubDispatcher(deps: DispatchDeps) {
  return {
    read: async <T>(feature: FeatureArea, clubId: string, domain: GroupDomain, fn: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> => {
      if (!activationStatus(deps.gates()).active) return deps.legacy(feature, clubId, fn);
      const { s } = await sessionFor(deps);
      return chooseRoute(deps.gates(), s.isAssigned(clubId)) === 'group' ? s.readClub(clubId, domain, fn) : deps.legacy(feature, clubId, fn);
    },
    write: async <T>(feature: FeatureArea, clubId: string, domain: GroupDomain, key: string, fn: (ctx: FeatureBackendContext, key: string) => Promise<T>, attempts?: number): Promise<T> => {
      if (!activationStatus(deps.gates()).active) return deps.legacy(feature, clubId, ctx => fn(ctx, key));
      const { s } = await sessionFor(deps);
      return chooseRoute(deps.gates(), s.isAssigned(clubId)) === 'group' ? s.writeClub(clubId, domain, key, fn, attempts) : deps.legacy(feature, clubId, ctx => fn(ctx, key));
    },
  };
}

/** Production dispatcher. Shipped gates are off, so this always takes the legacy path. */
export const clubDispatch = createClubDispatcher({
  gates: () => SHIPPED_GATES,
  legacy: async (feature, clubId, icp) => (await import('./featureRouter')).withFeatureBackend(feature, {
    supabase: () => { throw new Error('Club-scoped dispatch is ICP-only'); }, icp }, { clubId, legacy: true }),
  context: async () => {
    const [{ getCurrentInternetIdentityConfirmed }, { getActiveIcpTarget }] = await Promise.all([import('./internetIdentityAuth'), import('./targetRegistry')]);
    const identity = await getCurrentInternetIdentityConfirmed(3, 1000);
    if (!identity) throw new Error('Sign in again to continue.');
    return { identity, target: getActiveIcpTarget() };
  },
  open: async ctx => (await import('./groupSessionLive')).openLiveGroupReadSession(ctx),
});
