/** Club-scoped dispatcher: the single place app features ask "which canisters
 * serve this club?". While the switch-on lock is off (this build) every call
 * goes through withFeatureBackend to the shared canisters exactly as before.
 * When switched on, one group session per signed-in principal routes each club
 * to its assigned group; a club with no assignment stays on the shared
 * canisters (not yet moved). Never falls back from a group to the old canisters. */
import type { FeatureArea } from './featureBackend';
import type { FeatureBackendContext } from './featureRouter';
import type { GroupDomain, ClubAssignment } from './groupRouting';
import { activationStatus, SHIPPED_GATES, type ActivationGates } from './groupActivation';
import { generalRoutingStatus, generalRoutingDeploymentAlias } from './generalActivation';
import { clearOwnerTestRouting, readOwnerTestRouteCached } from './ownerTestRouting';
import { markScopedContext } from './scopedContext';
const READ_ACROSS_LEG_MS = 15_000;
import { clearRoleGrantsMemo } from './roleGrantsMemo';

type Session = { readClub<T>(c: string, d: GroupDomain, r: (ctx: FeatureBackendContext) => Promise<T>): Promise<T>;
  writeClub<T>(c: string, d: GroupDomain, k: string, w: (ctx: FeatureBackendContext, k: string) => Promise<T>, attempts?: number): Promise<T>;
  isAssigned(c: string): boolean; isLegacyMember?(c: string): boolean; memberClubIds?: string[]; dispose(): void;
  readHosted?<T>(c: string, d: GroupDomain, r: (ctx: FeatureBackendContext) => Promise<T>): Promise<T>;
  createInGroup?<T>(placement: ClubAssignment, d: GroupDomain, w: (ctx: FeatureBackendContext) => Promise<T>): Promise<T>;
  readMemberGroups?<T>(d: GroupDomain, r: (ctx: FeatureBackendContext) => Promise<readonly T[]>, maxRows?: number): Promise<T[]>;
  readEveryGroup<T>(d: GroupDomain, r: (ctx: FeatureBackendContext) => Promise<readonly T[]>, maxRows?: number): Promise<T[]> };
/** What a call is about. Non-club scopes are resolved to their owning club. */
export type EntityScope = { clubId: string } | { photoId: string } | { galleryCardId: string } | { newsId: string } | { competitionId: string } | { competitionMatchId: string } | { eoiId: string } | { seasonId: string } | { vaultFileId: string } | { vaultFolderId: string } | { notificationId: string } | { scheduledMessageId: string } | { eventGroupId: string } | { miniLeagueId: string } | { eventId: string } | { conversationId: string } | { teamId: string } | { clubLinkId: string } | { roleRequestId: string };
export type EntityKind = 'photo' | 'galleryCard' | 'news' | 'event' | 'conversation' | 'team' | 'clubLink' | 'roleRequest' | 'miniLeague' | 'competition' | 'competitionMatch' | 'eoi' | 'season' | 'vaultFile' | 'vaultFolder' | 'notification' | 'scheduledMessage' | 'eventGroup';
export type EntityLookup = (ctx: FeatureBackendContext, kind: EntityKind, id: string) => Promise<string | null>;
const ENTITY_DOMAIN = { photo: 'media_metadata', galleryCard: 'media_metadata', news: 'club_domain', eventGroup: 'events_domain', event: 'events_domain', conversation: 'messaging_domain', team: 'club_domain', clubLink: 'club_domain', roleRequest: 'club_domain', miniLeague: 'mini_league_domain', competition: 'competition_domain', competitionMatch: 'competition_domain', eoi: 'competition_domain', season: 'club_domain', vaultFile: 'vault_domain', vaultFolder: 'vault_domain', notification: 'notification_queue', scheduledMessage: 'notification_queue' } as const;
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
  /** Ask the global directory for an original-creator-bound placement. */
  placeNewClub?: (ctx: FeatureBackendContext, clubId: string) => Promise<ClubAssignment>;
  /** Independent consensus owner-test policy; never synthesizes global gates. */
  ownerActive?: () => Promise<boolean>;
  /** Live general-routing switch; production injects generalRoutingStatus. */
  generalActive?: (ctx: FeatureBackendContext) => Promise<boolean>;
};
export const MAX_DEVICE_OWNERS = 2000;
const owners = new Map<string, string | null>(); // kind:id -> club (null = shared canisters)
const inflight = new Map<string, Promise<string | null>>();
let loadedFor: string | null = null;
let cached: { principal: string; targetKey: string; session: Promise<Session>; ready: boolean } | null = null;
export function clearGroupDispatchCache() { cached?.session.then(s => s.dispose(), () => {}); cached = null; owners.clear(); inflight.clear(); loadedFor = null; unplaced.clear(); hostedChecked.clear(); reopening = null; }
// Clubs confirmed (after one reopen) to have no group assignment: legacy/shared.
const unplaced = new Set<string>();
const hostedChecked = new Set<string>();
let reopening: Promise<void> | null = null;

/** A club created or joined after the session opened is missing from it and
 * would wrongly fall to the original group. Reopen once (shared by concurrent
 * callers) before treating an unknown club as unplaced. */
async function sessionKnowing(deps: DispatchDeps, clubId: string | null) {
  let r = await sessionFor(deps);
  if (!clubId || r.s.isAssigned(clubId) || r.s.isLegacyMember?.(clubId) || unplaced.has(clubId)) return r;
  if (!reopening) {
    const stale = cached;
    reopening = (async () => {
      if (cached === stale) { stale?.session.then(x => x.dispose(), () => {}); cached = null; }
    })();
  }
  try { await reopening; } finally { reopening = null; }
  r = await sessionFor(deps);
  if (!r.s.isAssigned(clubId)) unplaced.add(clubId);
  return r;
}

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
  const targetKey = JSON.stringify([ctx.target.alias, ctx.target.host, ctx.target.networkKind,
    Object.entries(ctx.target.canisterIds ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
  if (!cached || cached.principal !== principal || cached.targetKey !== targetKey) {
    clearGroupDispatchCache();
    const entry = { principal, targetKey, session: deps.open(ctx), ready: false };
    cached = entry;
    entry.session.then(() => { entry.ready = true; }, () => {});
  }
  hydrate(deps, principal);
  try { return { ctx, s: await cached.session, principal }; } catch (e) { cached = null; throw e; }
}

/** Resolve a scope to its club. A remembered owner (device cache) whose club
 * this session doesn't place is re-checked: reopen once (newly created club),
 * otherwise forget the cached answer and probe the groups as before, so an
 * original-group club falls back to the shared canisters instead of failing. */
async function resolveScoped(deps: DispatchDeps, scope: EntityScope) {
  if ('clubId' in scope) { const r = await sessionKnowing(deps, scope.clubId); return { ...r, club: scope.clubId as string | null }; }
  let r = await sessionFor(deps);
  let club = await resolveClub(deps, r.s, r.principal, scope);
  if (club && !r.s.isAssigned(club) && !r.s.isLegacyMember?.(club) && !hostedChecked.has(club)) {
    r = await sessionKnowing(deps, club);
    if (!r.s.isAssigned(club)) {
      for (const [k, v] of owners) if (v === club) owners.delete(k);
      persist(deps, r.principal);
      club = await resolveClub(deps, r.s, r.principal, scope);
      if (club) hostedChecked.add(club); // a group really claims it: hosted, keep
    }
  }
  return { ...r, club };
}

/** Resolve an entity to its club by asking each of the member's groups at once.
 * Exactly one group may claim it; none = still on the shared canisters.
 * Answers are remembered (device + memory) and concurrent asks share one probe. */
async function resolveClub(deps: DispatchDeps, s: Session, principal: string, scope: EntityScope): Promise<string | null> {
  if ('clubId' in scope) return scope.clubId;
  const [kind, id] = 'photoId' in scope ? ['photo', scope.photoId] as const : 'galleryCardId' in scope ? ['galleryCard', scope.galleryCardId] as const : 'newsId' in scope ? ['news', scope.newsId] as const : 'competitionMatchId' in scope ? ['competitionMatch', scope.competitionMatchId] as const : 'eoiId' in scope ? ['eoi', scope.eoiId] as const : 'seasonId' in scope ? ['season', scope.seasonId] as const : 'vaultFileId' in scope ? ['vaultFile', scope.vaultFileId] as const : 'vaultFolderId' in scope ? ['vaultFolder', scope.vaultFolderId] as const : 'notificationId' in scope ? ['notification', scope.notificationId] as const : 'scheduledMessageId' in scope ? ['scheduledMessage', scope.scheduledMessageId] as const : 'eventGroupId' in scope ? ['eventGroup', scope.eventGroupId] as const : 'competitionId' in scope ? ['competition', scope.competitionId] as const : 'miniLeagueId' in scope ? ['miniLeague', scope.miniLeagueId] as const : 'eventId' in scope ? ['event', scope.eventId] as const : 'conversationId' in scope ? ['conversation', scope.conversationId] as const : 'clubLinkId' in scope ? ['clubLink', scope.clubLinkId] as const : 'roleRequestId' in scope ? ['roleRequest', scope.roleRequestId] as const : ['team', scope.teamId] as const;
  const key = `${kind}:${id}`;
  // A shared-team answer can outlive creation in a newly opened group.
  // Never let an old negative answer hide that team's current owner.
  if (owners.has(key) && !(kind === 'team' && owners.get(key) === null)) return owners.get(key) ?? null;
  const pending = inflight.get(key); if (pending) return pending;
  if (!deps.lookup) throw new Error('Entity lookup unavailable');
  const lookup = deps.lookup;
  const probe = (async () => {
    const found = [...new Set(await s.readEveryGroup(ENTITY_DOMAIN[kind], async ctx => { const c = await lookup(ctx, kind, id); return c ? [c] : []; }, 2))];
    if (found.length > 1) throw new Error(`${kind} claimed by more than one group`);
    const club = found[0] ?? null;
    if (!club && ['team', 'photo', 'galleryCard', 'news', 'competitionMatch', 'eoi', 'vaultFile', 'vaultFolder', 'notification', 'scheduledMessage'].includes(kind)) {
      const shared = await deps.context();
      const sharedClub = await lookup(shared, kind, id);
      if (!sharedClub) throw new Error(`${kind} not found or not authorized`);
      return null;
    }
    owners.set(key, club); if (club) persist(deps, principal);
    return club;
  })();
  inflight.set(key, probe);
  try { return await probe; } finally { inflight.delete(key); }
}

export function createClubDispatcher(deps: DispatchDeps) {
  // General routing first: when it's on (the normal case) the owner-opening
  // lookup is never needed, so ordinary reads skip that consensus call.
  const active = async () => activationStatus(deps.gates()).active ||
    Boolean(deps.generalActive && await deps.generalActive(await deps.context())) || Boolean(await deps.ownerActive?.());
  return {
    memberClubIds: async (): Promise<string[]> => {
      const { s } = await sessionFor(deps);
      return [...(s.memberClubIds ?? [])];
    },
    /** Atomically replace a discovery session; existing content keeps its session
     * while the new membership sweep is in flight. Failure retains the old one. */
    refreshMembershipSession: async (): Promise<void> => {
      if (!await active()) return;
      const previous = cached;
      if (!previous) { await sessionFor(deps); return; }
      // Other startup consumers may already be opening the same complete
      // inventory. Join it instead of running a second cold lookup in series
      // and disposing the session those consumers are about to use.
      if (!previous.ready) { await sessionFor(deps); return; }
      if (!reopening) {
        reopening = (async () => {
          const ctx = await deps.context();
          if (ctx.identity.getPrincipal().toText() !== previous.principal) throw new Error('Membership identity changed');
          const targetKey = JSON.stringify([ctx.target.alias, ctx.target.host, ctx.target.networkKind,
            Object.entries(ctx.target.canisterIds ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
          if (targetKey !== previous.targetKey) throw new Error('Membership target changed');
          const next = await deps.open(ctx);
          if (cached !== previous) { next.dispose(); return; }
          cached = { ...previous, session: Promise.resolve(next) };
          unplaced.clear(); hostedChecked.clear();
        })();
      }
      try { await reopening; } finally { reopening = null; }
    },
    /** Member content is distinct from unrestricted discovery/foreign hosts. */
    readMemberGroups: async <T, R>(feature: FeatureArea, domain: GroupDomain, fn0: (ctx: FeatureBackendContext) => Promise<T>, merge: (parts: T[]) => R): Promise<R> => {
      if (!await active()) return merge([await deps.legacy(feature, '', fn0)]);
      const { s } = await sessionFor(deps);
      if (!s.readMemberGroups) throw new Error('Member-group reads unavailable');
      const parts = await s.readMemberGroups(domain, async ctx => [await fn0(markScopedContext(ctx))], Number.MAX_SAFE_INTEGER);
      return merge(parts);
    },
    /** List reads already know each item's club: record it so opening the item
     * later (e.g. from a notification) needs no group probe. Free when off. */
    remember: async (kind: 'event' | 'conversation' | 'team' | 'miniLeague', pairs: ReadonlyArray<readonly [string, string]>): Promise<void> => {
      if (pairs.length === 0 || !await active()) return;
      let current = await sessionFor(deps);
      const clubs = [...new Set(pairs.map(([, club]) => club))];
      const unknown = clubs.find(club => !current.s.isAssigned(club) && !current.s.isLegacyMember?.(club) && !unplaced.has(club));
      if (unknown) {
        // One refresh checks the complete list, not one reopen per legacy club.
        current = await sessionKnowing(deps, unknown);
        for (const club of clubs) if (!current.s.isAssigned(club)) unplaced.add(club);
      }
      // Only group-placed clubs: an original-group (unplaced) club's items live
      // on the shared canisters and must not be sent to the hosted lookup.
      for (const [id, club] of pairs) {
        // A successful list read identifies original-group items too. Keep
        // their shared route in memory only, never persist negative placement.
        owners.set(`${kind}:${id}`, current.s.isAssigned(club) ? club : null);
      }
      persist(deps, current.principal);
    },
    /** Data spanning the caller's clubs: shared canisters + every group, asked
     * at the same time (load time = slowest group, not the sum). */
    readAcross: async <T, R>(feature: FeatureArea, domain: GroupDomain, fn0: (ctx: FeatureBackendContext) => Promise<T>, merge: (parts: T[]) => R, requireComplete = false): Promise<R> => {
      if (!await active()) return merge([await deps.legacy(feature, '', fn0)]);
      const fn = (ctx: FeatureBackendContext) => fn0(ctx && typeof ctx === 'object' ? markScopedContext(ctx) : ctx);
      const { s } = await sessionFor(deps);
      // Each group answers for itself: one failing group no longer empties
      // every other group's results. All failing still throws (keeps cache).
      type Part = { ok: true; value: T } | { ok: false; error: unknown };
      // A stalled group must not hold the whole screen: after the leg deadline it
      // counts as failed (partial results still show; requireComplete throws).
      const legDeadline = <V,>(p: Promise<V>, ms = READ_ACROSS_LEG_MS) => { let t: ReturnType<typeof setTimeout> | undefined; return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error('A club group took too long to answer')), ms); })]).finally(() => clearTimeout(t)); };
      const attempt = async (ctx: FeatureBackendContext): Promise<Part> => { try { return { ok: true, value: await legDeadline(fn(ctx)) }; } catch (error) { return { ok: false, error }; } };
      const [shared, groups] = await Promise.all([legDeadline(deps.legacy(feature, '', fn)).then((value): Part => ({ ok: true, value }), (error): Part => ({ ok: false, error })), legDeadline(s.readEveryGroup(domain, async ctx => [await attempt(ctx)], Number.MAX_SAFE_INTEGER), READ_ACROSS_LEG_MS + 10_000).catch((error): Part[] => [{ ok: false, error }])]);
      const parts = [shared, ...groups];
      if (requireComplete) {
        const failure = parts.find(p => !p.ok);
        if (failure && !failure.ok) throw failure.error;
      }
      const ok = parts.filter((p): p is { ok: true; value: T } => p.ok);
      if (ok.length === 0) { const first = parts.find(p => !p.ok) as { ok: false; error: unknown }; throw first.error; }
      return merge(ok.map(p => p.value));
    },
    /** Scope by event, chat, team or club; resolves the owning club first. */
    readFor: async <T>(feature: FeatureArea, scope: EntityScope, domain: GroupDomain, fn: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> => {
      if (!await active()) return deps.legacy(feature, 'clubId' in scope ? scope.clubId : '', fn);
      const { s, club } = await resolveScoped(deps, scope);
      if (club && !s.isAssigned(club) && !s.isLegacyMember?.(club) && !('clubId' in scope)) {
        if (!s.readHosted) throw new Error('Hosted club lookup unavailable');
        return s.readHosted(club, domain, fn);
      }
      return club && s.isAssigned(club) ? s.readClub(club, domain, fn) : deps.legacy(feature, club ?? '', fn);
    },
    writeFor: async <T>(feature: FeatureArea, scope: EntityScope, domain: GroupDomain, key: string, fn: (ctx: FeatureBackendContext, key: string) => Promise<T>, attempts?: number): Promise<T> => {
      if (!await active()) return deps.legacy(feature, 'clubId' in scope ? scope.clubId : '', ctx => fn(ctx, key));
      const { s, club } = await resolveScoped(deps, scope);
      if (club && !s.isAssigned(club) && !s.isLegacyMember?.(club) && !('clubId' in scope)) {
        if (!s.readHosted) throw new Error('Hosted club lookup unavailable');
        // Location only, one attempt: the destination verifies the actual
        // participant/claimant permission. Never manufacture club membership.
        return s.readHosted(club, domain, ctx => fn(ctx, key));
      }
      return club && s.isAssigned(club) ? s.writeClub(club, domain, key, fn, attempts) : deps.legacy(feature, club ?? '', ctx => fn(ctx, key));
    },
    /** Invite links/codes: the invitee isn't a member yet, so ask every group
     * which one holds the token and run the call there only. None = shared
     * canisters (club not moved). Two claims = refuse. Never retried; the
     * session is reopened afterwards so the newly joined club is routable. */
    forInvite: async <T>(feature: FeatureArea, token: string, fn: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> => {
      if (!await active()) return deps.legacy(feature, '', fn);
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
      if (!await active()) return deps.legacy(feature, clubId, fn);
      if (!deps.placeNewClub) throw new Error('Club placement unavailable');
      const ctx = await deps.context();
      const placement = await deps.placeNewClub(ctx, clubId);
      if (placement.clubId !== clubId) throw new Error('Foreign club placement');
      // Placement changes the registry revision. Do not create from the session
      // captured before that mutation; reopen against its acknowledged receipt.
      clearGroupDispatchCache();
      const { s } = await sessionFor(deps);
      if (!s.createInGroup) throw new Error('Club placement unavailable');
      try { return await s.createInGroup(placement, 'club_domain', fn); }
      finally { cached?.session.then(x => x.dispose(), () => {}); cached = null; }
    },
    read: async <T>(feature: FeatureArea, clubId: string, domain: GroupDomain, fn: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> => {
      if (!await active()) return deps.legacy(feature, clubId, fn);
      const { s } = await sessionKnowing(deps, clubId);
      return s.isAssigned(clubId) ? s.readClub(clubId, domain, fn) : deps.legacy(feature, clubId, fn);
    },
    write: async <T>(feature: FeatureArea, clubId: string, domain: GroupDomain, key: string, fn: (ctx: FeatureBackendContext, key: string) => Promise<T>, attempts?: number): Promise<T> => {
      if (!await active()) return deps.legacy(feature, clubId, ctx => fn(ctx, key));
      const { s } = await sessionKnowing(deps, clubId);
      return s.isAssigned(clubId) ? s.writeClub(clubId, domain, key, fn, attempts) : deps.legacy(feature, clubId, ctx => fn(ctx, key));
    },
  };
}

/** Production dispatcher. Shipped gates are off, so this always takes the legacy path. */
export const clubDispatch = createClubDispatcher({
  gates: () => SHIPPED_GATES,
  generalActive: ctx => generalRoutingStatus(ctx).then(s => s.active),
  legacy: async (feature, clubId, icp) => (await import('./featureRouter')).withFeatureBackend(feature, {
    supabase: () => { throw new Error('Club-scoped dispatch is ICP-only'); }, icp }, { clubId, legacy: true }),
  context: async () => {
    const [{ getCurrentInternetIdentityConfirmed }, { getActiveIcpTarget }] = await Promise.all([import('./internetIdentityAuth'), import('./targetRegistry')]);
    const identity = await getCurrentInternetIdentityConfirmed(3, 1000);
    if (!identity) throw new Error('Sign in again to continue.');
    return { identity, target: getActiveIcpTarget() };
  },
  ownerActive: async () => {
    const [{ getCurrentInternetIdentityConfirmed }, { getActiveIcpTarget }] = await Promise.all([import('./internetIdentityAuth'), import('./targetRegistry')]);
    const identity = await getCurrentInternetIdentityConfirmed(3, 1000);
    if (!identity) throw new Error('Sign in again to continue.');
    return Boolean(await readOwnerTestRouteCached({ identity, target: getActiveIcpTarget() }));
  },
  open: async ctx => (await import('./groupSessionLive')).openLiveGroupReadSession(ctx,
    (await generalRoutingStatus(ctx)).active ? undefined : (await readOwnerTestRouteCached(ctx))?.groupId),
  lookup: async (ctx, kind, id) => (await import('./groupSessionLive')).lookupEntityClub(ctx, kind, id),
  holdsInvite: async (ctx, token) => (await import('./groupSessionLive')).groupHoldsInvite(ctx, token),
  placeNewClub: async (ctx, clubId) => {
    const { connectLiveShardRouter } = await import('./domains');
    const { actor } = await connectLiveShardRouter(ctx.target, ctx.identity);
    const reply = await actor.place_my_new_club(clubId, generalRoutingDeploymentAlias() ?? ctx.target.alias);
    if ('Err' in reply) throw new Error(reply.Err);
    return { clubId: reply.Ok.club_id, groupId: reply.Ok.group_id, revision: reply.Ok.revision };
  },
  store: {
    load: p => JSON.parse(localStorage.getItem(`ignite.groupOwners.${p}`) ?? '{}'),
    save: (p, o) => localStorage.setItem(`ignite.groupOwners.${p}`, JSON.stringify(o)),
  },
});

/** Sign-out: forget every entity→club answer kept on this device. */
export function wipeGroupOwnerCache() {
  clearRoleGrantsMemo();
  clearOwnerTestRouting();
  clearGroupDispatchCache();
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('ignite.groupOwners.')) localStorage.removeItem(k); } catch { /* no storage */ }
}
