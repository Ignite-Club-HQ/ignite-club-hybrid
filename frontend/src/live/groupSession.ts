/** Explicit inactive integration: no registration in production dispatch.
 * Transport must use the configured router's authenticated consensus APIs.
 */
import type { FeatureBackendContext } from './featureRouter';
import type { GroupDescriptor, ClubAssignment, GroupDomain } from './groupRouting';
import { GROUP_DOMAINS } from './groupRouting';
import { resolveDeploymentClubDomain, groupRouteScope, type GroupDeployment, type GroupDeploymentBinding, type DeploymentBoundTable } from './groupDeployment';
import { readCompleteMembershipDirectory, type DirectoryPage, type DirectoryContinuation } from './membershipDirectoryDiscovery';

export type GroupRegistry = { revision: bigint; groups: GroupDescriptor[]; deployment: GroupDeployment; bindings: GroupDeploymentBinding[] };
export type GroupSessionTransport = {
  readRegistry(): Promise<GroupRegistry>;
  /** Explicit opt-in only after source propagation is verified.
   * Absence, failure or uncertainty keeps complete Stage A discovery. */
  readMembershipDirectory?(ctx: FeatureBackendContext, continuation: DirectoryContinuation | null, registryFingerprint: string): Promise<DirectoryPage>;
  readMemberships(ctx: FeatureBackendContext, offset: bigint, limit: number): Promise<{ clubs: string[]; next: bigint | null; aclRevision: bigint }>;
  readAssignments(clubs: string[], revision: bigint): Promise<ClubAssignment[]>;
  /** Required only where original shared clubs are not registered as a group. */
  readLegacyMemberships?(ctx: FeatureBackendContext, offset: bigint, limit: number): Promise<{ clubs: string[]; next: bigint | null; aclRevision: bigint }>;
  /** Original creator's consensus receipt, not membership or permission. */
  readNewClubPlacement?(clubId: string, revision: bigint): Promise<ClubAssignment>;
  /** Faster cursor pager (cost scales with the caller's own clubs). Throws APP_WIDE_INDEX_ERROR for app-wide accounts, which use the scan pager. */
  readMembershipsIndexed?(ctx: FeatureBackendContext, after: string | null, limit: number): Promise<{ clubs: string[]; next: string | null; aclRevision: bigint }>;
  /** Group of a club the caller may not belong to (e.g. a competition host). Returns location only; destinations keep their own access rules. */
  readHostedAssignment?(clubId: string, revision: bigint): Promise<ClubAssignment>;
  /** On-chain deployment name the registry groups carry, when it differs from
   * the frontend's own target alias (a local name for the same deployment).
   * Read after readRegistry(); the session binds routing to this name. */
  deploymentAlias?(): string | undefined;
};
/** A group's clubs use only that group's photo store: shared stores answer to
 * another group's club service and would refuse (or misjudge) its clubs. */
export function groupCanisterIds<T extends Record<string, string | undefined>>(shared: T, group: GroupDescriptor): T {
  const ids: Record<string, string | undefined> = Object.fromEntries(Object.entries(shared).filter(([k]) => !k.startsWith('media_blob_store')));
  for (const d of group.domains) ids[d.domain] = d.canisterId;
  if (group.photoStore) ids.media_blob_store = group.photoStore;
  return ids as T;
}
export const APP_WIDE_INDEX_ERROR = /app-wide accounts/i;
const MAX_CLUBS = 1000;
const MAX_PAGES = 500;

/** How long one confirmed registry/assignment check is reused. */
export const RECHECK_WINDOW_MS = 15_000;
/** Ordinary member reads reuse a confirmed registry/assignment check for longer:
 * each re-check is several consensus calls in series before the page's own read,
 * and every destination canister still enforces access on each call. Writes,
 * hosted lookups and creation keep the strict window above. */
export const READ_RECHECK_WINDOW_MS = 5 * 60_000;
export async function openGroupSession(context: FeatureBackendContext, transport: GroupSessionTransport) {
  const principal = context.identity.getPrincipal().toText();
  if (!principal || principal === '2vxsx-fae') throw new Error('Authenticated group session required');
  const sameIdentity = () => { if (context.identity.getPrincipal().toText() !== principal) throw new Error('Group session identity changed'); };
  const registry = await transport.readRegistry();
  const registryFingerprint = (value: GroupRegistry) => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v);
  const initialRegistry = registryFingerprint(registry);
  sameIdentity();
  const expectedAlias = transport.deploymentAlias?.() ?? context.target.alias;
  if (registry.revision < 1n || registry.groups.length < 1 || registry.groups.length > 4096 ||
      registry.deployment.alias !== expectedAlias || registry.deployment.networkKind !== context.target.networkKind ||
      new URL(registry.deployment.host).origin !== new URL(context.target.host).origin ||
      registry.bindings.length !== registry.groups.length || new Set(registry.groups.map(g => g.id)).size !== registry.groups.length ||
      new Set(registry.bindings.map(b => b.groupId)).size !== registry.bindings.length) throw new Error('Invalid authoritative group registry');
  const routing = { groups: new Map(registry.groups.map(g => [g.id, g])), assignments: new Map<string, ClubAssignment>() };
  const table: DeploymentBoundTable = { routing, deployments: new Map([[registry.deployment.id, registry.deployment]]), bindings: new Map(registry.bindings.map(b => [b.groupId, b])) };
  // Validate every domain of every group BEFORE any membership read.
  for (const g of registry.groups) {
    const probe = `__validation:${g.id}`;
    routing.assignments.set(probe, { clubId: probe, groupId: g.id, revision: registry.revision });
    resolveDeploymentClubDomain(table, registry.deployment, probe, 'club_domain');
    routing.assignments.delete(probe);
  }
  const targetFor = (groupId: string) => {
    const group = routing.groups.get(groupId);
    if (!group) throw new Error('Unknown group');
    return { ...context, target: { ...context.target, canisterIds: groupCanisterIds(context.target.canisterIds, group) } };
  };
  const clubs = new Set<string>();
  const claim = (club: string, groupId: string) => {
    if (!club || club.length > 64) throw new Error('Invalid or changing membership page');
    if (clubs.has(club)) throw new Error('Club claimed by multiple groups or repeated page');
    clubs.add(club);
    if (clubs.size > MAX_CLUBS) throw new Error('Membership discovery exceeds club budget');
    // Group ownership validated after the registry confirms assignments.
    routing.assignments.set(club, { clubId: club, groupId, revision: registry.revision });
  };
  const scanGroup = async (group: GroupDescriptor) => {
    let offset = 0n; let pages = 0; let acl: bigint | undefined;
    while (true) {
      if (++pages > MAX_PAGES) throw new Error('Membership discovery exceeds scan budget');
      const page = await transport.readMemberships(targetFor(group.id), offset, 100);
      sameIdentity();
      if (page.clubs.length > 100 || page.clubs.some(c => !c || c.length > 64) ||
          (acl !== undefined && acl !== page.aclRevision) ||
          (page.next !== null && (page.next <= offset || page.next - offset > 200n))) throw new Error('Invalid or changing membership page');
      acl = page.aclRevision;
      for (const club of page.clubs) claim(club, group.id);
      if (page.next === null) return;
      offset = page.next;
    }
  };
  // Indexed pages must be strictly ascending, start after the cursor and
  // end exactly at the returned cursor, so a page can never repeat or skip.
  const indexedGroup = async (group: GroupDescriptor, read: NonNullable<GroupSessionTransport['readMembershipsIndexed']>) => {
    let after: string | null = null; let pages = 0; let acl: bigint | undefined;
    while (true) {
      if (++pages > MAX_PAGES) throw new Error('Membership discovery exceeds scan budget');
      let page: Awaited<ReturnType<typeof read>>;
      try { page = await read(targetFor(group.id), after, 100); }
      catch (e) { if (pages === 1 && APP_WIDE_INDEX_ERROR.test((e as Error).message)) { sameIdentity(); return scanGroup(group); } throw e; }
      sameIdentity();
      const ascending = page.clubs.every((c, i) => (i === 0 ? after === null || c > after : c > page.clubs[i - 1]));
      if (page.clubs.length > 100 || !ascending || (acl !== undefined && acl !== page.aclRevision) ||
          (page.next !== null && (page.clubs.length === 0 || page.next !== page.clubs[page.clubs.length - 1]))) throw new Error('Invalid or changing membership page');
      acl = page.aclRevision;
      for (const club of page.clubs) claim(club, group.id);
      if (page.next === null) return;
      after = page.next;
    }
  };
  const legacyClubs = new Set<string>();
  let directoryUsed = false;
  const discoveryStartedAt = Date.now();
  if (transport.readMembershipDirectory) {
    try {
      const directory = await readCompleteMembershipDirectory(principal, initialRegistry,
        continuation => transport.readMembershipDirectory?.(context, continuation, initialRegistry) ?? Promise.reject(new Error('Directory unavailable')), sameIdentity);
      // Validate the entire result before modifying any routing inventory.
      if (directory.assignments.some(row => !routing.groups.has(row.groupId) || row.revision > registry.revision)) throw new Error('Foreign directory assignment');
      for (const row of directory.assignments) claim(row.clubId, row.groupId);
      for (const club of directory.legacyClubs) legacyClubs.add(club);
      directoryUsed = true;
    } catch {
      sameIdentity();
      clubs.clear(); routing.assignments.clear(); legacyClubs.clear();
      console.info('[Membership discovery]', { path: 'lookup-fallback', elapsedMs: Date.now() - discoveryStartedAt });
    }
  }
  // Without a complete verified directory, every source must answer. Failures
  // never turn a partial discovery into a successful empty membership list.
  if (!directoryUsed) await Promise.all(registry.groups.map(group => transport.readMembershipsIndexed
    ? indexedGroup(group, transport.readMembershipsIndexed.bind(transport))
    : scanGroup(group)));
  const sharedRegistered = registry.groups.some(g => g.domains.some(d => d.domain === 'club_domain' && d.canisterId === context.target.canisterIds.club_domain));
  if (!directoryUsed && !sharedRegistered && transport.readLegacyMemberships) {
    let offset = 0n;
    for (let pageCount = 0; ; pageCount++) {
      if (pageCount >= MAX_PAGES) throw new Error('Legacy membership scan exceeds budget');
      const page = await transport.readLegacyMemberships(context, offset, 100);
      sameIdentity();
      if (page.clubs.length > 100 || page.clubs.some(id => !id || id.length > 64 || clubs.has(id) || legacyClubs.has(id)) ||
        (page.next !== null && page.next <= offset)) throw new Error('Invalid legacy membership page');
      for (const id of page.clubs) legacyClubs.add(id);
      if (legacyClubs.size + clubs.size > MAX_CLUBS) throw new Error('Membership discovery exceeds club budget');
      if (page.next === null) break;
      offset = page.next;
    }
  }
  const validateAssignments = async (requested: readonly string[]) => {
    const chunks: string[][] = [];
    for (let offset = 0; offset < requested.length; offset += 20) chunks.push(requested.slice(offset, offset + 20));
    // Chunks are independent consensus reads; ask them together.
    await Promise.all(chunks.map(async chunk => {
      const rows = await transport.readAssignments([...chunk], registry.revision);
      sameIdentity();
      if (rows.length !== chunk.length || new Set(rows.map(r => r.clubId)).size !== rows.length) throw new Error('Incomplete group assignments');
      for (const row of rows) {
        const previous = routing.assignments.get(row.clubId);
        if (!chunk.includes(row.clubId) || !previous || row.groupId !== previous.groupId || row.revision < 1n || row.revision > registry.revision) throw new Error('Foreign or stale club assignment');
        routing.assignments.set(row.clubId, row);
      }
    }));
  };
  await validateAssignments([...clubs]);
  console.info('[Membership discovery]', { path: directoryUsed ? 'permanent-lookup' : 'source-scan', elapsedMs: Date.now() - discoveryStartedAt, groupCount: registry.groups.length });
  const openedAt = Date.now();
  let disposed = false;
  const live = () => { if (disposed || context.identity.getPrincipal().toText() !== principal) throw new Error('Group session changed or disposed'); };
  // A registry check is two full consensus reads (seconds). Consecutive calls
  // within a short window share one confirmed check; canisters still enforce
  // access on every call. Creation passes fresh=true and always re-reads.
  // The registry was just read while opening: seed the window.
  let registryCheckedAt = openedAt; let registryCheck: Promise<void> | null = null;
  // strict: writes and hosted lookups never rely on the open-time read alone.
  const assertRegistryUnchanged = async (fresh = false, strict = false, windowMs = RECHECK_WINDOW_MS) => {
    live();
    if (!fresh && !(strict && registryCheckedAt === openedAt) && Date.now() - registryCheckedAt < windowMs) return;
    if (!fresh && registryCheck) return registryCheck;
    const run = (async () => {
      const current = await transport.readRegistry();
      live();
      if (registryFingerprint(current) !== initialRegistry) throw new Error('Group registry changed; reopen session');
      registryCheckedAt = Date.now();
    })();
    if (!fresh) registryCheck = run;
    try { await run; } finally { if (registryCheck === run) registryCheck = null; }
  };
  // Post-read confirmation shared by concurrent all-group reads. A read may
  // join a check only if that check's registry read starts after the read's
  // replies arrived (monotonic tick), so the in-flight guarantee is unchanged;
  // a page firing several all-group reads pays one confirmation, not one each.
  let checkTick = 0;
  let pendingFresh: { tick: number; run: Promise<void> } | null = null;
  const confirmUnchangedAfter = (after: number): Promise<void> => {
    live();
    if (pendingFresh && pendingFresh.tick > after) return pendingFresh.run;
    const entry: { tick: number; run: Promise<void> } = { tick: Number.POSITIVE_INFINITY, run: Promise.resolve() };
    entry.run = (async () => {
      // Let siblings whose replies land in the same turn join this check.
      await Promise.resolve(); await Promise.resolve();
      entry.tick = ++checkTick;
      const current = await transport.readRegistry();
      live();
      if (registryFingerprint(current) !== initialRegistry) throw new Error('Group registry changed; reopen session');
      registryCheckedAt = Date.now();
    })().finally(() => { if (pendingFresh === entry) pendingFresh = null; });
    pendingFresh = entry;
    return entry.run;
  };
  // Opening validated every discovered club; seed their check time.
  const assignmentCheckedAt = new Map<string, number>([...clubs].map(id => [id, openedAt]));
  const assignmentInflight = new Map<string, Promise<void>>();
  const checkStale = async (requested: readonly string[], fresh: boolean, strict = false, windowMs = RECHECK_WINDOW_MS) => {
    await assertRegistryUnchanged(fresh, strict, windowMs);
    const now = Date.now();
    const checkedAt = (id: string) => { const t = assignmentCheckedAt.get(id) ?? 0; return strict && t === openedAt ? 0 : t; };
    const unique = [...new Set(requested)];
    // Concurrent asks for the same club share one in-flight check.
    const waiting = fresh ? [] : unique.map(id => assignmentInflight.get(id)).filter((p): p is Promise<void> => !!p);
    const stale = unique.filter(id => (fresh || now - checkedAt(id) >= windowMs) && (fresh || !assignmentInflight.has(id)));
    if (stale.length) {
      const run = validateAssignments(stale).then(() => { for (const id of stale) assignmentCheckedAt.set(id, Date.now()); });
      for (const id of stale) assignmentInflight.set(id, run);
      try { await run; } finally { for (const id of stale) if (assignmentInflight.get(id) === run) assignmentInflight.delete(id); }
    }
    await Promise.all(waiting);
  };
  const revalidate = async (requested: readonly string[], fresh = false, strict = false, windowMs = RECHECK_WINDOW_MS) => {
    live();
    if (requested.length > MAX_CLUBS || requested.some(id => !clubs.has(id))) throw new Error('Club outside discovered membership');
    await checkStale(requested, fresh, strict, windowMs);
    live();
  };
  /** Member reads: gated on a confirmed check within the read window. Once that
   * check is half-way stale, refresh it in the background so a later page
   * open does not pay the consensus round trips in front of its own read.
   * Background failure changes nothing: the next read re-checks in front. */
  const revalidateForRead = async (requested: readonly string[]) => {
    await revalidate(requested, false, false, READ_RECHECK_WINDOW_MS);
    if (!disposed) void checkStale(requested, false, false, READ_RECHECK_WINDOW_MS / 2).catch(() => undefined);
  };
  const inflight = new Map<string, Promise<unknown>>();
  const api = {
    clubIds: [...clubs].sort(),
    memberClubIds: [...clubs, ...legacyClubs].sort(),
    isLegacyMember(clubId: string) { return legacyClubs.has(clubId); },
    /** Ordinary member-content reads never query groups with no member clubs. */
    async readMemberGroups<T>(domain: GroupDomain, read: (ctx: FeatureBackendContext) => Promise<readonly T[]>, maxRows = 1000): Promise<T[]> {
      if (!GROUP_DOMAINS.includes(domain)) throw new Error('Unknown group domain');
      await revalidateForRead([...clubs]);
      const memberGroups = new Set([...clubs].map(id => routing.assignments.get(id)?.groupId));
      const reads = registry.groups.filter(g => memberGroups.has(g.id)).map(g => read(targetFor(g.id)));
      if (legacyClubs.size) reads.push(read(context));
      const parts = await Promise.all(reads);
      live();
      const rows = parts.flat();
      if (rows.length > maxRows) throw new Error('Member-group read exceeds row budget');
      return rows;
    },
    /** True when this member's club has a group assignment in the registry. */
    isAssigned(clubId: string) { return clubs.has(clubId); },
    dispose() { disposed = true; },
    /** Checks the full captured registry without rediscovering revoked memberships. */
    assertRegistryUnchanged,
    deletionRegistryRevision: registry.revision,
    async readClub<T>(clubId: string, domain: GroupDomain, read: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> {
      if (!GROUP_DOMAINS.includes(domain)) throw new Error('Unknown group domain');
      await revalidateForRead([clubId]);
      const route = resolveDeploymentClubDomain(table, registry.deployment, clubId, domain);
      groupRouteScope(route, principal);
      const result = await read(targetFor(route.groupId)); live(); return result;
    },
    /** Routed write: revalidated before every attempt, pinned to one group,
     * retried only on transient transport errors with the SAME idempotency key,
     * coalesced per key, never redirected or falling back. */
    async writeClub<T>(clubId: string, domain: GroupDomain, idempotencyKey: string,
      write: (ctx: FeatureBackendContext, key: string) => Promise<T>, attempts = 3): Promise<T> {
      if (!GROUP_DOMAINS.includes(domain)) throw new Error('Unknown group domain');
      if (!idempotencyKey || idempotencyKey.length > 128) throw new Error('Write idempotency key required');
      const scoped = `${clubId}|${domain}|${idempotencyKey}`;
      const existing = inflight.get(scoped);
      if (existing) return existing as Promise<T>;
      const run = (async () => {
        let pinned: string | undefined; let uncertain = false;
        for (let attempt = 1; ; attempt++) {
          try { await revalidate([clubId], attempt > 1, true); }
          catch (e) { if (uncertain) throw new Error(`Write outcome uncertain; ${(e as Error).message}`); throw e; }
          const route = resolveDeploymentClubDomain(table, registry.deployment, clubId, domain);
          if (pinned && pinned !== route.groupId) throw new Error('Write group changed during retry');
          pinned = route.groupId; groupRouteScope(route, principal);
          try { const result = await write(targetFor(route.groupId), idempotencyKey); live(); return result; }
          catch (e) {
            if (!isTransientWriteError(e) || attempt >= attempts) {
              if (uncertain || isTransientWriteError(e)) throw new Error(`Write outcome uncertain after ${attempt} attempt(s): ${(e as Error).message}`);
              throw e;
            }
            uncertain = true;
          }
        }
      })();
      inflight.set(scoped, run);
      try { return await run; } finally { inflight.delete(scoped); }
    },
    /** Read something hosted by another club (e.g. a competition this club entered).
     * Location comes from the router; the destination canister decides access.
     * Read-only: writes stay limited to the caller's own discovered clubs. */
    async readHosted<T>(hostClubId: string, domain: GroupDomain, read: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> {
      if (!GROUP_DOMAINS.includes(domain)) throw new Error('Unknown group domain');
      live();
      if (!hostClubId || hostClubId.length > 64) throw new Error('Invalid host club');
      if (clubs.has(hostClubId)) return api.readClub(hostClubId, domain, read);
      if (!transport.readHostedAssignment) throw new Error('Hosted club lookup unavailable');
      await assertRegistryUnchanged(false, true);
      const row = await transport.readHostedAssignment(hostClubId, registry.revision); live();
      if (row.clubId !== hostClubId || !routing.groups.has(row.groupId) || row.revision < 1n || row.revision > registry.revision) throw new Error('Foreign or stale club assignment');
      routing.assignments.set(hostClubId, row);
      try {
        const route = resolveDeploymentClubDomain(table, registry.deployment, hostClubId, domain);
        groupRouteScope(route, principal);
        const result = await read(targetFor(route.groupId)); live(); return result;
      } finally { routing.assignments.delete(hostClubId); }
    },
    /** Create a brand-new club in the group the router just placed it in.
     * Single attempt (creates are never retried); the group must be in this
     * session's verified registry. Reopen the session afterwards. */
    async createInGroup<T>(placement: ClubAssignment, domain: GroupDomain, write: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> {
      if (domain !== 'club_domain') throw new Error('New club creation requires club_domain');
      live();
      if (!placement.clubId || clubs.has(placement.clubId) || placement.revision < 1n || placement.revision > registry.revision ||
          !registry.groups.some(g => g.id === placement.groupId)) throw new Error('Invalid new club placement');
      if (!transport.readNewClubPlacement) throw new Error('Creator placement verification unavailable');
      await assertRegistryUnchanged(true);
      const current = await transport.readNewClubPlacement(placement.clubId, registry.revision);
      live();
      if (current.clubId !== placement.clubId || current.groupId !== placement.groupId || current.revision !== placement.revision) throw new Error('Creator placement changed');
      await assertRegistryUnchanged(true);
      // Exactly one attempt. Unknown creation outcomes require readback, not replay.
      const result = await write(targetFor(placement.groupId)); live(); return result;
    },
    /** Bounded read across every group, for discovery that is not keyed by one
     * club (e.g. competitions a team entered, wherever they are hosted).
     * Every group must answer; results keep registry order. */
    async readEveryGroup<T>(domain: GroupDomain, read: (ctx: FeatureBackendContext) => Promise<readonly T[]>, maxRows = 1000): Promise<T[]> {
      if (!GROUP_DOMAINS.includes(domain)) throw new Error('Unknown group domain');
      live();
      await assertRegistryUnchanged(false, false, READ_RECHECK_WINDOW_MS);
      const parts = await Promise.all(registry.groups.map(g => read(targetFor(g.id))));
      // Fresh: a registry change while replies were in flight must discard them.
      // Sibling reads that finished before one fresh check started share it.
      await confirmUnchangedAfter(++checkTick);
      const rows = parts.flat();
      if (rows.length > maxRows) throw new Error('Cross-group read exceeds row budget');
      return rows;
    },
    async readClubs<T>(requested: readonly string[], domain: GroupDomain,
      read: (ctx: FeatureBackendContext, clubIds: readonly string[]) => Promise<readonly T[]>): Promise<T[]> {
      if (!GROUP_DOMAINS.includes(domain)) throw new Error('Unknown group domain');
      await revalidateForRead(requested);
      const batches = new Map<string, { ids: string[]; indices: number[] }>();
      requested.forEach((id, index) => {
        const route = resolveDeploymentClubDomain(table, registry.deployment, id, domain);
        const batch = batches.get(route.groupId) ?? { ids: [], indices: [] };
        batch.ids.push(id); batch.indices.push(index); batches.set(route.groupId, batch);
      });
      const rows = await Promise.all([...batches].map(async ([group, batch]) => {
        const results = await read(targetFor(group), batch.ids);
        if (results.length !== batch.ids.length) throw new Error('Group returned incomplete results');
        return results.map((value, i) => ({ value, index: batch.indices[i] }));
      }));
      live(); return rows.flat().sort((a, b) => a.index - b.index).map(r => r.value);
    },
  };
  return api;
}
/** Only transport-level loss may be retried; canister rejections (permission,
 * validation, quota) are final so a retry can never widen access. */
export function isTransientWriteError(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (/(not authori|permission|denied|forbidden|membership|quota|invalid|not found)/.test(m)) return false;
  return /(timeout|timed out|network|fetch failed|unavailable|sys_transient|reject_code: 2|ingress_expiry|connection)/.test(m);
}
