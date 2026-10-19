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
  createInGroup?<T>(g: string, d: GroupDomain, w: (ctx: FeatureBackendContext) => Promise<T>): Promise<T>;
  readEveryGroup<T>(d: GroupDomain, r: (ctx: FeatureBackendContext) => Promise<readonly T[]>, maxRows?: number): Promise<T[]> };
/** What a call is about. Non-club scopes are resolved to their owning club. */
export type EntityScope = { clubId: string } | { eventId: string } | { conversationId: string } | { teamId: string };
export type EntityLookup = (ctx: FeatureBackendContext, kind: 'event' | 'conversation' | 'team', id: string) => Promise<string | null>;
const ENTITY_DOMAIN = { event: 'events_domain', conversation: 'messaging_domain', team: 'club_domain' } as const;
/** Device store for entity→club answers (an event/chat never changes club, so
 * positive answers are safe to keep; "not in any group" stays memory-only
 * because the club may move later). Scoped per principal. */
export type OwnerStore = { load(principal: string): Record<string, string>; save(principal: string, owners: Record<string, string>): void };
export type DispatchDeps = {
  gates: () => ActivationGates;
  legacy: <T>(feature: FeatureArea, clubId: string, icp: (ctx: FeatureBackendContext) => Promise<T>) => Promise<T>;
  context: () => Promise<FeatureBackendContext>;
  open: (ctx: FeatureBackendContext) => Promise<Session>;
  lookup?: EntityLookup;
  /** Does this group hold the invite token? (invitees aren't members yet) */
  holdsInvite?: (ctx: FeatureBackendContext, token: string) => Promise<boolean>;
  store?: OwnerStore;
  /** Ask the global directory to place a new club; returns its group id. */
  placeNewClub?: (ctx: FeatureBackendContext, clubId: string) => Promise<string>;
};
export const MAX_DEVICE_OWNERS = 2000;
const owners = new Map<string, string | null>(); // kind:id -> club (null = shared canisters)
const inflight = new Map<string, Promise<string | null>>();
let loadedFor: string | null = null;
let cached: { principal: string; session: Promise<Session> } | null = null;
export function clearGroupDispatchCache() { cached?.session.then(s => s.dispose(), () => {}); cached = null; owners.clear(); inflight.clear(); loadedFor = null; }

function hydrate(deps: DispatchDeps, principal: string) {
  if (loadedFor === principal) return; loadedFor = principal;
  try { for (const [k, v] of Object.entries(deps.store?.load(principal) ?? {})) if (!owners.has(k)) owners.set(k, v); } catch { /* unreadable store = cold cache */ }
}
function persist(deps: DispatchDeps, principal: string) {
  if (!deps.store) return;
  const known = [...owners].filter((e): e is [string, string] => e[1] !== null).slice(-MAX_DEVICE_OWNERS);
  try { deps.store.save(principal, Object.fromEntries(known)); } catch { /* quota: keep memory copy */ }
}

async function sessionFor(deps: DispatchDeps): Promise<{ ctx: FeatureBackendContext; s: Session; principal: string }> {
  const ctx = await deps.context(); const principal = ctx.identity.getPrincipal().toText();
  if (!cached || cached.principal !== principal) { clearGroupDispatchCache(); cached = { principal, session: deps.open(ctx) }; }
  hydrate(deps, principal);
  try { return { ctx, s: await cached.session, principal }; } catch (e) { cached = null; throw e; }
}

/** Resolve an entity to its club by asking each of the member's groups at once.
 * Exactly one group may claim it; none = still on the shared canisters.
 * Answers are remembered (device + memory) and concurrent asks share one probe. */
async function resolveClub(deps: DispatchDeps, s: Session, principal: string, scope: EntityScope): Promise<string | null> {
  if ('clubId' in scope) return scope.clubId;
  const [kind, id] = 'eventId' in scope ? ['event', scope.eventId] as const : 'conversationId' in scope ? ['conversation', scope.conversationId] as const : ['team', scope.teamId] as const;
  const key = `${kind}:${id}`;
  if (owners.has(key)) return owners.get(key)!;
  const pending = inflight.get(key); if (pending) return pending;
  if (!deps.lookup) throw new Error('Entity lookup unavailable');
  const lookup = deps.lookup;
  const probe = (async () => {
    const found = [...new Set(await s.readEveryGroup(ENTITY_DOMAIN[kind], async ctx => { const c = await lookup(ctx, kind, id); return c ? [c] : []; }, 2))];
    if (found.length > 1) throw new Error(`${kind} claimed by more than one group`);
    const club = found[0] ?? null;
    owners.set(key, club); if (club) persist(deps, principal);
    return club;
  })();
  inflight.set(key, probe);
  try { return await probe; } finally { inflight.delete(key); }
}

export function createClubDispatcher(deps: DispatchDeps) {
  return {
    /** List reads already know each item's club: record it so opening the item
     * later (e.g. from a notification) needs no group probe. Free when off. */
    remember: async (kind: 'event' | 'conversation' | 'team', pairs: ReadonlyArray<readonly [string, string]>): Promise<void> => {
      if (!activationStatus(deps.gates()).active || pairs.length === 0) return;
      const { principal } = await sessionFor(deps);
      for (const [id, club] of pairs) owners.set(`${kind}:${id}`, club);
      persist(deps, principal);
    },
    /** Data spanning the caller's clubs: shared canisters + every group, asked
     * at the same time (load time = slowest group, not the sum). */
    readAcross: async <T, R>(feature: FeatureArea, domain: GroupDomain, fn: (ctx: FeatureBackendContext) => Promise<T>, merge: (parts: T[]) => R): Promise<R> => {
      if (!activationStatus(deps.gates()).active) return merge([await deps.legacy(feature, '', fn)]);
      const { s } = await sessionFor(deps);
      const [shared, groups] = await Promise.all([deps.legacy(feature, '', fn), s.readEveryGroup(domain, async ctx => [await fn(ctx)], Number.MAX_SAFE_INTEGER)]);
      return merge([shared, ...groups]);
    },
    /** Scope by event, chat, team or club; resolves the owning club first. */
    readFor: async <T>(feature: FeatureArea, scope: EntityScope, domain: GroupDomain, fn: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> => {
      if (!activationStatus(deps.gates()).active) return deps.legacy(feature, 'clubId' in scope ? scope.clubId : '', fn);
      const { s, principal } = await sessionFor(deps); const club = await resolveClub(deps, s, principal, scope);
      return club && chooseRoute(deps.gates(), s.isAssigned(club)) === 'group' ? s.readClub(club, domain, fn) : deps.legacy(feature, club ?? '', fn);
    },
    writeFor: async <T>(feature: FeatureArea, scope: EntityScope, domain: GroupDomain, key: string, fn: (ctx: FeatureBackendContext, key: string) => Promise<T>, attempts?: number): Promise<T> => {
      if (!activationStatus(deps.gates()).active) return deps.legacy(feature, 'clubId' in scope ? scope.clubId : '', ctx => fn(ctx, key));
      const { s, principal } = await sessionFor(deps); const club = await resolveClub(deps, s, principal, scope);
      return club && chooseRoute(deps.gates(), s.isAssigned(club)) === 'group' ? s.writeClub(club, domain, key, fn, attempts) : deps.legacy(feature, club ?? '', ctx => fn(ctx, key));
    },
    /** Invite links/codes: the invitee isn't a member yet, so ask every group
     * which one holds the token and run the call there only. None = shared
     * canisters (club not moved). Two claims = refuse. Never retried; the
     * session is reopened afterwards so the newly joined club is routable. */
    forInvite: async <T>(feature: FeatureArea, token: string, fn: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> => {
      if (!activationStatus(deps.gates()).active) return deps.legacy(feature, '', fn);
      if (!deps.holdsInvite) throw new Error('Invite lookup unavailable');
      const holds = deps.holdsInvite;
      const { s } = await sessionFor(deps);
      const hits = await s.readEveryGroup('club_domain', async ctx => (await holds(ctx, token)) ? [ctx] : [], 2);
      if (hits.length > 1) throw new Error('Invite claimed by more than one group');
      try { return hits[0] ? await fn(hits[0]) : await deps.legacy(feature, '', fn); }
      finally { cached?.session.then(x => x.dispose(), () => {}); cached = null; }
    },
    /** Creating a club/association: the global directory picks the group
     * (healthiest with room), then the club is created there, once. If no
     * group is placed the call fails rather than silently using shared. */
    forNewClub: async <T>(feature: FeatureArea, clubId: string, fn: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> => {
      if (!activationStatus(deps.gates()).active) return deps.legacy(feature, clubId, fn);
      if (!deps.placeNewClub) throw new Error('Club placement unavailable');
      const { ctx, s } = await sessionFor(deps);
      if (!s.createInGroup) throw new Error('Club placement unavailable');
      const groupId = await deps.placeNewClub(ctx, clubId);
      try { return await s.createInGroup(groupId, 'club_domain', fn); }
      finally { cached?.session.then(x => x.dispose(), () => {}); cached = null; }
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
  holdsInvite: async (ctx, token) => (await import('./groupSessionLive')).groupHoldsInvite(ctx, token),
  placeNewClub: async (ctx, clubId) => {
    const { connectLiveShardRouter } = await import('./domains');
    const { actor } = await connectLiveShardRouter(ctx.target, ctx.identity);
    const reply = await actor.place_my_new_club(clubId, ctx.target.alias);
    if ('Err' in reply) throw new Error(reply.Err);
    return reply.Ok.group_id;
  },
  store: {
    load: p => JSON.parse(localStorage.getItem(`ignite.groupOwners.${p}`) ?? '{}'),
    save: (p, o) => localStorage.setItem(`ignite.groupOwners.${p}`, JSON.stringify(o)),
  },
});

/** Sign-out: forget every entity→club answer kept on this device. */
export function wipeGroupOwnerCache() {
  clearGroupDispatchCache();
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('ignite.groupOwners.')) localStorage.removeItem(k); } catch { /* no storage */ }
}
