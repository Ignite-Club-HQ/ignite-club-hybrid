import { Principal } from '@icp-sdk/core/principal';
import { GROUP_DOMAINS } from './groupRouting';

type Domain = { domain: string; canister: Principal };
type Placement = {
  group_id: string; deployment_id: string; deployment_revision: bigint; host: string; network_kind: string;
  primary_subnet: Principal; approved_subnets: Principal[]; additional_subnets_enabled: boolean;
  domains: Array<Domain & { subnet: Principal }>;
};
export type AccountRegistrySnapshot = {
  revision: bigint; groups: Array<{ id: string; target_alias: string; domains: Domain[] }>; placements: Placement[];
};
export type AccountRegistryBinding = {
  targetAlias: string; deploymentId: string; deploymentRevision: bigint; host: string; networkKind: string;
  /** On-chain deployment alias may differ from the app's runtime target alias. */
  registryAlias?: string;
  registryRevision: bigint; requiredClubAuthorities: readonly string[];
};

/** Consensus registry transport authenticates rows; validation binds the entire
 * inventory to operator-approved deployment evidence. It never enables groups. */
export function accountAuthoritiesFromRegistry(snapshot: AccountRegistrySnapshot, binding: AccountRegistryBinding) {
  if (snapshot.revision !== binding.registryRevision || !snapshot.groups.length || snapshot.groups.length > 4096 ||
      snapshot.groups.length !== snapshot.placements.length || new Set(snapshot.groups.map(g => g.id)).size !== snapshot.groups.length ||
      new Set(snapshot.placements.map(p => p.group_id)).size !== snapshot.placements.length) throw new Error('Incomplete or stale account registry');
  if (!binding.deploymentId || binding.deploymentRevision < 1n || !binding.host.startsWith('https://') ||
      new URL(binding.host).origin !== binding.host || !['public_mainnet', 'cloud_engine'].includes(binding.networkKind)) throw new Error('Invalid account deployment binding');
  const authorities = new Set<string>();
  const validPrincipal = (p: Principal) => !p.isAnonymous() && p.toText() !== 'aaaaa-aa';
  let subnetSignature: string | undefined;
  const groups = snapshot.groups.map(g => {
    const p = snapshot.placements.find(p => p.group_id === g.id);
    if (!p || g.target_alias !== (binding.registryAlias ?? binding.targetAlias) || p.deployment_id !== binding.deploymentId ||
        p.deployment_revision !== binding.deploymentRevision || p.host !== binding.host || p.network_kind !== binding.networkKind) throw new Error('Foreign account authority deployment');
    const approved = p.approved_subnets.map(s => s.toText()).sort();
    if (!approved.length || approved.length > 64 || new Set(approved).size !== approved.length ||
        !approved.includes(p.primary_subnet.toText()) || p.approved_subnets.some(s => !validPrincipal(s))) throw new Error('Invalid account subnet approvals');
    const signature = JSON.stringify([p.primary_subnet.toText(), approved, p.additional_subnets_enabled]);
    if (subnetSignature !== undefined && subnetSignature !== signature) throw new Error('Mixed account subnet approvals');
    subnetSignature = signature;
    if (g.domains.length !== GROUP_DOMAINS.length || p.domains.length !== GROUP_DOMAINS.length ||
        new Set(g.domains.map(d => d.domain)).size !== GROUP_DOMAINS.length || new Set(p.domains.map(d => d.domain)).size !== GROUP_DOMAINS.length ||
        new Set(g.domains.map(d => d.canister.toText())).size !== GROUP_DOMAINS.length) throw new Error('Incomplete account domain inventory');
    for (const d of g.domains) {
      const placed = p.domains.find(v => v.domain === d.domain);
      if (!(GROUP_DOMAINS as readonly string[]).includes(d.domain) || !validPrincipal(d.canister) || !placed ||
          placed.canister.toText() !== d.canister.toText() || !approved.includes(placed.subnet.toText()) ||
          (!p.additional_subnets_enabled && placed.subnet.toText() !== p.primary_subnet.toText())) throw new Error('Unapproved account domain placement');
    }
    const clubDomain = g.domains.find(d => d.domain === 'club_domain')?.canister.toText();
    if (!clubDomain || authorities.has(clubDomain)) throw new Error('Duplicate account club authority');
    authorities.add(clubDomain);
    return { groupId: g.id, clubDomain };
  });
  if (!binding.requiredClubAuthorities.length || new Set(binding.requiredClubAuthorities).size !== binding.requiredClubAuthorities.length ||
      binding.requiredClubAuthorities.some(id => !authorities.has(id))) throw new Error('Missing legacy account authority');
  return groups.sort((a, b) => a.groupId.localeCompare(b.groupId));
}

/** Lazy transport; registry reads use consensus, never membership discovery or
 * local storage. This only returns an inventory, not release authorization. */
export async function readLiveAccountAuthorityRegistry(
  ctx: import('./featureRouter').FeatureBackendContext, binding: AccountRegistryBinding,
) {
  const snapshot = await readLiveAccountAuthoritySnapshot(ctx, binding);
  return { revision: snapshot.revision, groups: accountAuthoritiesFromRegistry(snapshot, binding) };
}

/** Complete consensus inventory for original-PII routing. No approved binding
 * is derived from the reply itself, and no membership/cache fallback exists. */
export async function readLiveAccountAuthoritySnapshot(
  ctx: import('./featureRouter').FeatureBackendContext, binding: AccountRegistryBinding,
): Promise<AccountRegistrySnapshot> {
  binding = { ...binding, requiredClubAuthorities: [...binding.requiredClubAuthorities] };
  if (ctx.target.alias !== binding.targetAlias || new URL(ctx.target.host).origin !== binding.host ||
      ctx.target.networkKind !== binding.networkKind || ctx.identity.getPrincipal().isAnonymous()) throw new Error('Account registry target mismatch');
  const identity = ctx.identity;
  const principal = identity.getPrincipal().toText();
  const target = JSON.stringify(ctx.target);
  const recheck = () => {
    if (ctx.identity !== identity || identity.getPrincipal().toText() !== principal || JSON.stringify(ctx.target) !== target || ctx.target.status === 'disabled') throw new Error('Registry identity or target changed');
  };
  recheck();
  const { connectLiveShardRouter } = await import('./domains');
  recheck();
  const { actor } = await connectLiveShardRouter(ctx.target, identity);
  recheck();
  const { readPinnedGroupRegistry } = await import('./groupRegistryPager');
  recheck();
  const snapshot = await readPinnedGroupRegistry((revision, cursor, limit) => actor.read_group_registry_page(binding.registryAlias ?? binding.targetAlias, revision, cursor, limit),
    binding.registryRevision, recheck);
  recheck();
  accountAuthoritiesFromRegistry(snapshot, binding);
  return snapshot;
}