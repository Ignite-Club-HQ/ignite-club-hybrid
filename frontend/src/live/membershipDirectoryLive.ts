/** Lazy caller-private actor connection. Diagnostic responses never become
 * discovery answers; this transport remains hard-off pending release proof. */
import type { FeatureBackendContext } from './featureRouter';
import type { DirectoryContinuation, DirectoryPage } from './membershipDirectoryDiscovery';
import type { Reply, ReleasedReply } from '../lab/bindings/identity_access/declarations/identity_access.did';
import type { GroupRegistry } from './groupSession';

// The app may attempt the reader; only the identity-owned release plus a
// freshly checked page can replace Stage A. Old deployments refuse safely.
export const MEMBERSHIP_LOOKUP_RELEASE_ENABLED = true;

export function requireVerifiedDirectoryReply(reply: Reply, caller: string): Reply {
  if (reply.caller.toText() !== caller || reply.account_version < 1n || reply.generation < 1n || reply.registry_revision < 1n ||
      reply.inventory_digest.length !== 32 || reply.rows.length > 100) throw new Error('Membership directory identity or inventory changed');
  if (!reply.verified_current) throw new Error('Membership directory requires Stage A discovery');
  return reply;
}

/** Real diagnostic endpoint for explicitly requested private acceptance; not
 * invoked by ordinary navigation while the release switch is off. */
export async function readLiveMembershipDirectoryDiagnostic(
  ctx: FeatureBackendContext, consumer: bigint, continuation: DirectoryContinuation | null,
): Promise<Reply> {
  const principal = ctx.identity.getPrincipal().toText();
  if (!principal || principal === '2vxsx-fae') throw new Error('Authenticated lookup caller required');
  const [{ createLiveActor }, { idlFactory }] = await Promise.all([
    import('./icpAgent'), import('../lab/bindings/identity_access/declarations/identity_access.did.js'),
  ]);
  const { actor } = await createLiveActor<import('../lab/bindings/identity_access/declarations/identity_access.did')._SERVICE>(
    ctx.target, ctx.identity, 'identity_access', 'Identity access', idlFactory,
  );
  const response = await actor.read_my_membership_directory_diagnostic(consumer, continuation ? [continuation] : []);
  if (ctx.identity.getPrincipal().toText() !== principal) throw new Error('Membership directory identity changed');
  if ('Err' in response) throw new Error(response.Err);
  if (response.Ok.caller.toText() !== principal) throw new Error('Foreign membership directory caller');
  return response.Ok;
}

export function convertReleasedDirectoryReply(reply: ReleasedReply, caller: string, fingerprint: string): DirectoryPage {
  const page = requireVerifiedDirectoryReply(reply.page, caller);
  if (reply.instance < 1n || !/^[a-f0-9]{40}$/.test(reply.release)) throw new Error('Lookup release changed');
  const expected = JSON.parse(fingerprint) as GroupRegistry;
  const registry = reply.registry;
  const text = (v: unknown) => String(v);
  if (text(registry.revision) !== text(expected.revision) || text(page.registry_revision) !== text(expected.revision) ||
      registry.groups.length !== expected.groups.length || registry.placements.length !== expected.bindings.length) throw new Error('Lookup registry changed');
  for (const g of registry.groups) {
    const match = expected.groups.find(v => v.id === g.id);
    if (!match || match.targetAlias !== g.target_alias || match.domains.length !== g.domains.length ||
        g.domains.some(d => !match.domains.some(v => v.domain === d.domain && v.canisterId === d.canister.toText()))) throw new Error('Lookup group inventory changed');
  }
  for (const p of registry.placements) {
    const match = expected.bindings.find(v => v.groupId === p.group_id), d = expected.deployment;
    if (!match || p.host !== d.host || p.network_kind !== d.networkKind || p.deployment_id !== d.id ||
        text(p.deployment_revision) !== text(d.revision) || p.primary_subnet.toText() !== d.primarySubnet ||
        p.additional_subnets_enabled !== d.additionalSubnetsEnabled ||
        JSON.stringify(p.approved_subnets.map(v => v.toText()).sort()) !== JSON.stringify([...d.approvedSubnets].sort()) ||
        match.domains.length !== p.domains.length || p.domains.some(v => !match.domains.some(m => m.domain === v.domain && m.canisterId === v.canister.toText() && m.subnetId === v.subnet.toText()))) throw new Error('Lookup deployment changed');
  }
  const assignments: DirectoryPage['assignments'] = [], legacyClubs: string[] = [];
  for (const row of page.rows) {
    const group = registry.groups.find(g => g.id === row.group_id);
    if (!group) {
      if (row.group_id !== 'g1' || row.authority.toText() !== 'mzzzv-taaaa-aaaal-qxlrq-cai') throw new Error('Foreign legacy authority');
      legacyClubs.push(row.club_id);
    } else {
      if (!group.domains.some(d => d.domain === 'club_domain' && d.canister.toText() === row.authority.toText())) throw new Error('Foreign club authority');
      assignments.push({ clubId: row.club_id, groupId: row.group_id, revision: page.registry_revision });
    }
  }
  return { caller, accountVersion: page.account_version, generation: page.generation, directoryRevision: page.registry_revision,
    registryFingerprint: fingerprint, instance: reply.instance, verifiedCurrent: true, assignments, legacyClubs, next: page.next[0] ?? null };
}

/** Each session owns one consumer and one immutable actor/identity binding. */
export function releasedMembershipDirectoryReader() {
  const consumer = BigInt(Date.now()) * 65536n + BigInt(Math.floor(Math.random() * 65536));
  let captured: string | undefined;
  return async (ctx: FeatureBackendContext, continuation: DirectoryContinuation | null, fingerprint: string): Promise<DirectoryPage> => {
    const caller = ctx.identity.getPrincipal().toText();
    const binding = JSON.stringify([caller, ctx.target.host, ctx.target.canisterIds.identity_access, fingerprint]);
    if (captured !== undefined && captured !== binding) throw new Error('Lookup caller or target changed');
    captured = binding;
    if (caller === '2vxsx-fae') throw new Error('Authenticated lookup caller required');
    const [{ createLiveActor }, { idlFactory }] = await Promise.all([
      import('./icpAgent'), import('../lab/bindings/identity_access/declarations/identity_access.did.js'),
    ]);
    const { actor } = await createLiveActor<import('../lab/bindings/identity_access/declarations/identity_access.did')._SERVICE>(ctx.target, ctx.identity, 'identity_access', 'Identity access', idlFactory);
    const response = await actor.read_my_membership_directory(consumer, continuation ? [continuation] : []);
    if (ctx.identity.getPrincipal().toText() !== caller) throw new Error('Lookup caller changed');
    if ('Err' in response) throw new Error(response.Err);
    return convertReleasedDirectoryReply(response.Ok, caller, fingerprint);
  };
}