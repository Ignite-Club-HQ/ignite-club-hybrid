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
  isAssigned(c: string): boolean; dispose(): void;
  readEveryGroup<T>(d: GroupDomain, r: (ctx: FeatureBackendContext) => Promise<readonly T[]>, maxRows?: number): Promise<T[]> };
/** What a call is about. Non-club scopes are resolved to their owning club. */
export type EntityScope = { clubId: string } | { eventId: string } | { conversationId: string } | { teamId: string };
export type EntityLookup = (ctx: FeatureBackendContext, kind: 'event' | 'conversation' | 'team', id: string) => Promise<string | null>;
const ENTITY_DOMAIN = { event: 'events_domain', conversation: 'messaging_domain', team: 'club_domain' } as const;
export type DispatchDeps = {
  gates: () => ActivationGates;
  legacy: <T>(feature: FeatureArea, clubId: string, icp: (ctx: FeatureBackendContext) => Promise<T>) => Promise<T>;
  context: () => Promise<FeatureBackendContext>;
  open: (ctx: FeatureBackendContext) => Promise<Session>;
  lookup?: EntityLookup;
};
const owners = new Map<string, string | null>(); // kind:id -> club (null = shared canisters)
let cached: { principal: string; session: Promise<Session> } | null = null;
export function clearGroupDispatchCache() { cached?.session.then(s => s.dispose(), () => {}); cached = null; owners.clear(); }

async function sessionFor(deps: DispatchDeps): Promise<{ ctx: FeatureBackendContext; s: Session }> {
  const ctx = await deps.context(); const principal = ctx.identity.getPrincipal().toText();
  if (!cached || cached.principal !== principal) { clearGroupDispatchCache(); cached = { principal, session: deps.open(ctx) }; }
  try { return { ctx, s: await cached.session }; } catch (e) { cached = null; throw e; }
}

/** Resolve an entity to its club by asking each of the member's groups.
 * Exactly one group may claim it; none = still on the shared canisters. */
async function resolveClub(deps: DispatchDeps, s: Session, scope: EntityScope): Promise<string | null> {
  if ('clubId' in scope) return scope.clubId;
  const [kind, id] = 'eventId' in scope ? ['event', scope.eventId] as const : 'conversationId' in scope ? ['conversation', scope.conversationId] as const : ['team', scope.teamId] as const;
  const key = `${kind}:${id}`;
  if (owners.has(key)) return owners.get(key)!;
  if (!deps.lookup) throw new Error('Entity lookup unavailable');
  const lookup = deps.lookup;
  const found = [...new Set(await s.readEveryGroup(ENTITY_DOMAIN[kind], async ctx => { const c = await lookup(ctx, kind, id); return c ? [c] : []; }, 2))];
  if (found.length > 1) throw new Error(`${kind} claimed by more than one group`);
  const club = found[0] ?? null;
  owners.set(key, club);
  return club;
}

export function createClubDispatcher(deps: DispatchDeps) {
  return {
    /** Scope by event, chat, team or club; resolves the owning club first. */
    readFor: async <T>(feature: FeatureArea, scope: EntityScope, domain: GroupDomain, fn: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> => {
      if (!activationStatus(deps.gates()).active) return deps.legacy(feature, 'clubId' in scope ? scope.clubId : '', fn);
      const { s } = await sessionFor(deps); const club = await resolveClub(deps, s, scope);
      return club && chooseRoute(deps.gates(), s.isAssigned(club)) === 'group' ? s.readClub(club, domain, fn) : deps.legacy(feature, club ?? '', fn);
    },
    writeFor: async <T>(feature: FeatureArea, scope: EntityScope, domain: GroupDomain, key: string, fn: (ctx: FeatureBackendContext, key: string) => Promise<T>, attempts?: number): Promise<T> => {
      if (!activationStatus(deps.gates()).active) return deps.legacy(feature, 'clubId' in scope ? scope.clubId : '', ctx => fn(ctx, key));
      const { s } = await sessionFor(deps); const club = await resolveClub(deps, s, scope);
      return club && chooseRoute(deps.gates(), s.isAssigned(club)) === 'group' ? s.writeClub(club, domain, key, fn, attempts) : deps.legacy(feature, club ?? '', ctx => fn(ctx, key));
    },
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
  lookup: async (ctx, kind, id) => (await import('./groupSessionLive')).lookupEntityClub(ctx, kind, id),
});
