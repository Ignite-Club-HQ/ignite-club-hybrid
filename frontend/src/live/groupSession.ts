/** Explicit inactive integration: no registration in production dispatch.
 * Transport must use the configured router's authenticated consensus APIs.
 */
import type { FeatureBackendContext } from './featureRouter';
import type { GroupDescriptor, ClubAssignment, GroupDomain } from './groupRouting';
import { GROUP_DOMAINS } from './groupRouting';
import { resolveDeploymentClubDomain, groupRouteScope, type GroupDeployment, type GroupDeploymentBinding, type DeploymentBoundTable } from './groupDeployment';

export type GroupRegistry = { revision: bigint; groups: GroupDescriptor[]; deployment: GroupDeployment; bindings: GroupDeploymentBinding[] };
export type GroupSessionTransport = {
  readRegistry(): Promise<GroupRegistry>;
  readMemberships(ctx: FeatureBackendContext, offset: bigint, limit: number): Promise<{ clubs: string[]; next: bigint | null; aclRevision: bigint }>;
  readAssignments(clubs: string[], revision: bigint): Promise<ClubAssignment[]>;
};
const MAX_CLUBS = 1000;
const MAX_PAGES = 500;

export async function openGroupSession(context: FeatureBackendContext, transport: GroupSessionTransport) {
  const principal = context.identity.getPrincipal().toText();
  if (!principal || principal === '2vxsx-fae') throw new Error('Authenticated group session required');
  const registry = await transport.readRegistry();
  if (registry.revision < 1n || registry.groups.length < 1 || registry.groups.length > 64 ||
      registry.deployment.alias !== context.target.alias || registry.deployment.networkKind !== context.target.networkKind ||
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
    return { ...context, target: { ...context.target, canisterIds: {
      ...context.target.canisterIds, ...Object.fromEntries(group.domains.map(d => [d.domain, d.canisterId])),
    } } };
  };
  const clubs = new Set<string>();
  for (const group of registry.groups) {
    let offset = 0n; let pages = 0; let acl: bigint | undefined;
    while (true) {
      if (++pages > MAX_PAGES) throw new Error('Membership discovery exceeds scan budget');
      const page = await transport.readMemberships(targetFor(group.id), offset, 100);
      if (page.clubs.length > 100 || page.clubs.some(c => !c || c.length > 64) ||
          (acl !== undefined && acl !== page.aclRevision) ||
          (page.next !== null && (page.next <= offset || page.next - offset > 200n))) throw new Error('Invalid or changing membership page');
      acl = page.aclRevision;
      for (const club of page.clubs) {
        if (clubs.has(club)) throw new Error('Club claimed by multiple groups or repeated page');
        clubs.add(club);
        if (clubs.size > MAX_CLUBS) throw new Error('Membership discovery exceeds club budget');
        // Group ownership validated after the registry confirms assignments.
        routing.assignments.set(club, { clubId: club, groupId: group.id, revision: registry.revision });
      }
      if (page.next === null) break;
      offset = page.next;
    }
  }
  const validateAssignments = async (requested: readonly string[]) => {
    for (let offset = 0; offset < requested.length; offset += 20) {
      const chunk = requested.slice(offset, offset + 20);
      const rows = await transport.readAssignments([...chunk], registry.revision);
      if (rows.length !== chunk.length || new Set(rows.map(r => r.clubId)).size !== rows.length) throw new Error('Incomplete group assignments');
      for (const row of rows) {
        const previous = routing.assignments.get(row.clubId);
        if (!chunk.includes(row.clubId) || !previous || row.groupId !== previous.groupId || row.revision < 1n || row.revision > registry.revision) throw new Error('Foreign or stale club assignment');
        routing.assignments.set(row.clubId, row);
      }
    }
  };
  await validateAssignments([...clubs]);
  let disposed = false;
  const live = () => { if (disposed || context.identity.getPrincipal().toText() !== principal) throw new Error('Group session changed or disposed'); };
  const revalidate = async (requested: readonly string[]) => {
    live();
    if (requested.length > MAX_CLUBS || requested.some(id => !clubs.has(id))) throw new Error('Club outside discovered membership');
    const current = await transport.readRegistry();
    if (current.revision !== registry.revision) throw new Error('Group registry changed; reopen session');
    await validateAssignments([...new Set(requested)]); live();
  };
  return {
    clubIds: [...clubs].sort(),
    dispose() { disposed = true; },
    async readClub<T>(clubId: string, domain: GroupDomain, read: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> {
      if (!GROUP_DOMAINS.includes(domain)) throw new Error('Unknown group domain');
      await revalidate([clubId]);
      const route = resolveDeploymentClubDomain(table, registry.deployment, clubId, domain);
      groupRouteScope(route, principal);
      const result = await read(targetFor(route.groupId)); live(); return result;
    },
    async readClubs<T>(requested: readonly string[], domain: GroupDomain,
      read: (ctx: FeatureBackendContext, clubIds: readonly string[]) => Promise<readonly T[]>): Promise<T[]> {
      if (!GROUP_DOMAINS.includes(domain)) throw new Error('Unknown group domain');
      await revalidate(requested);
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
}