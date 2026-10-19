/** Pure assignment resolver; intentionally not connected to production actors.
 * Only accept tables returned by the authenticated authoritative control plane.
 * Resolution is not authorization and never falls back to another deployment.
 */
export const GROUP_DOMAINS = [
  'club_domain', 'events_domain', 'messaging_domain', 'vault_domain',
  'competition_domain', 'club_points_domain', 'mini_league_domain',
  'media_metadata', 'insights_domain', 'notification_queue',
  'pii_access_control', 'timer_jobs', 'secret_workload_identity',
] as const;
export type GroupDomain = typeof GROUP_DOMAINS[number];
export type GroupDescriptor = {
  id: string;
  targetAlias: string;
  domains: ReadonlyArray<{ domain: GroupDomain; canisterId: string }>;
  /** The group's own photo store; absent means its clubs cannot upload (fail closed). */
  photoStore?: string;
};
export type ClubAssignment = { clubId: string; groupId: string; revision: bigint };
export type GroupRoutingTable = {
  groups: ReadonlyMap<string, GroupDescriptor>;
  assignments: ReadonlyMap<string, ClubAssignment>;
};
export function resolveClubDomain(table: GroupRoutingTable, targetAlias: string, clubId: string, domain: GroupDomain) {
  const assignment = table.assignments.get(clubId);
  if (!assignment || assignment.clubId !== clubId || assignment.revision < 1n) throw new Error('Missing authoritative club assignment');
  const group = table.groups.get(assignment.groupId);
  if (!group || group.id !== assignment.groupId || group.targetAlias !== targetAlias) throw new Error('Club group belongs to another deployment or is missing');
  const domains = new Map<GroupDomain, string>();
  const ids = new Set<string>();
  for (const item of group.domains) {
    if (!(GROUP_DOMAINS as readonly string[]).includes(item.domain) || domains.has(item.domain) || ids.has(item.canisterId) || !/^[a-z0-9-]+-cai$/.test(item.canisterId)) throw new Error('Invalid group domain table');
    domains.set(item.domain, item.canisterId); ids.add(item.canisterId);
  }
  if (domains.size !== GROUP_DOMAINS.length) throw new Error('Incomplete club group');
  const canisterId = domains.get(domain);
  if (!canisterId) throw new Error('Unmapped group domain');
  return { groupId: group.id, canisterId, revision: assignment.revision };
}
/** Split requests deterministically without dropping duplicates or losing order. */
export function partitionClubRequests<T extends { clubId: string }>(table: GroupRoutingTable, target: string, domain: GroupDomain, requests: readonly T[]) {
  const batches = new Map<string, { route: ReturnType<typeof resolveClubDomain>; requests: Array<{ index: number; value: T }> }>();
  requests.forEach((value, index) => {
    const route = resolveClubDomain(table, target, value.clubId, domain);
    const batch = batches.get(route.groupId) ?? { route, requests: [] };
    batch.requests.push({ index, value }); batches.set(route.groupId, batch);
  });
  return batches;
}

/** All-or-nothing batch execution groundwork; destinations still authorize callers.
 * One result per request is required, including duplicates. Never return partial
 * rows after a shard failure or silently substitute a different canister.
 */
export async function executeClubBatches<T extends { clubId: string }, R>(
  table: GroupRoutingTable,
  target: string,
  domain: GroupDomain,
  requests: readonly T[],
  read: (route: ReturnType<typeof resolveClubDomain>, requests: readonly T[]) => Promise<readonly R[]>,
): Promise<R[]> {
  // Resolve every request before starting any reads, so invalid assignments
  // cannot trigger a partially routed operation.
  const batches = partitionClubRequests(table, target, domain, requests);
  const completed = await Promise.all([...batches.values()].map(async batch => {
    const rows = await read(batch.route, batch.requests.map(request => request.value));
    if (rows.length !== batch.requests.length) throw new Error('Club group returned an incomplete batch');
    return batch.requests.map((request, offset) => ({ index: request.index, row: rows[offset] }));
  }));
  return completed.flat().sort((a, b) => a.index - b.index).map(item => item.row);
}