/** Browser-safe canonical configuration evidence. Runtime health and club counts
 * are deliberately excluded; placement, policy and service identities are not. */
import type { ShardGroup, GroupPlacement } from '../lab/bindings/shard_router/declarations/shard_router.did';

export function groupApprovalConfiguration(groups: readonly ShardGroup[], placements: readonly GroupPlacement[]): string {
  const placed = new Map(placements.map(p => [p.group_id, p]));
  if (placed.size !== placements.length || groups.length !== placements.length || new Set(groups.map(g => g.id)).size !== groups.length) {
    throw new Error('Incomplete or duplicate approval inventory');
  }
  return JSON.stringify([...groups].sort((a, b) => a.id.localeCompare(b.id)).map(g => {
    const p = placed.get(g.id);
    if (!p) throw new Error('Missing approved group placement');
    return {
      id: g.id, targetAlias: g.target_alias, accepting: g.accepting,
      maxClubs: g.max_clubs, heapBudgetBytes: String(g.heap_budget_bytes), minCycles: String(g.min_cycles),
      photoStore: g.photo_store[0]?.toText() ?? null,
      domains: g.domains.map(d => ({ domain: d.domain, canisterId: d.canister.toText() })).sort((a, b) => a.domain.localeCompare(b.domain)),
      placement: {
        deploymentId: p.deployment_id, revision: String(p.deployment_revision), host: p.host, networkKind: p.network_kind,
        primarySubnet: p.primary_subnet.toText(), additionalSubnetsEnabled: p.additional_subnets_enabled,
        approvedSubnets: p.approved_subnets.map(s => s.toText()).sort(),
        domains: p.domains.map(d => ({ domain: d.domain, canisterId: d.canister.toText(), subnetId: d.subnet.toText() }))
          .sort((a, b) => a.domain.localeCompare(b.domain)),
      },
    };
  }));
}

/** Lowercase hex SHA-256 of the canonical approval text (browser and Node 20+). */
export async function approvalConfigurationSha256(configuration: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(configuration));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
