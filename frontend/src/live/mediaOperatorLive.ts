import { readPinnedGroupRegistry } from './groupRegistryPager';
/** Explicit governor-only live transport, lazy-loaded by operator tooling.
 * Never imports into app boot and never switches routing or permits a move. */
import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';
import { createMediaOperatorRegistry, type MediaRegistryPlacement } from './mediaOperatorRegistry';
import { mediaTransferPreparation, reconciledMediaTransferInventory, type MediaPreparationDeps } from './mediaTransferPreparation';
import { readCompleteMediaMetadata } from './mediaMetadataReader';
import type { MediaMetadataEvidence, MediaAuthorityEvidence } from './mediaAuthorityReconciliation';

export async function createLiveMediaOperator(binding: {
  moveId: string; clubId: string; deploymentId: string; fromGroup: string; toGroup: string; governor: string;
}, d: { target: IcpTargetConfig; identity: Identity;
  load: MediaPreparationDeps['load']; save: MediaPreparationDeps['save'];
  /** Legacy records lack provenance: obtain signed, ciphertext-bound evidence
   * through an approved attestation workflow, not a guessed URL mapping. */
  readProvenance(): Promise<MediaMetadataEvidence['provenance']>;
  readAuthorities(storage: Awaited<ReturnType<ReturnType<typeof mediaTransferPreparation>['prepare']>>): Promise<MediaAuthorityEvidence>;
}) {
  const { Actor, CanisterStatus } = await import('@icp-sdk/core/agent');
  const { Principal } = await import('@icp-sdk/core/principal');
  const { createLiveAgent } = await import('./icpAgent');
  const { connectLiveShardRouter, connectLiveClubDomain, connectLiveMediaMetadata, connectLiveMessagingDomain, connectLiveVaultDomain } = await import('./domains');
  const { idlFactory: storeIdl } = await import('../lab/bindings/media_blob_store/declarations/media_blob_store.did.js');
  if (!binding.governor || d.identity.getPrincipal().isAnonymous() || d.identity.getPrincipal().toText() !== binding.governor)
    throw new Error('Approved governor identity required for photo operator');
  if (d.target.status === 'disabled' || d.target.status === 'read_only' || d.target.networkKind !== 'public_mainnet')
    throw new Error('Photo operator requires enabled public mainnet; Cloud Engine attestation remains gated');
  const agent = await createLiveAgent(d.target, d.identity);
  const { actor: router } = await connectLiveShardRouter(d.target, d.identity);
  const at = (domain: string, id: string): IcpTargetConfig => ({ ...d.target, canisterIds: { ...d.target.canisterIds, [domain]: id } });
  const snapshot = async () => {
    const r = { Ok: await readPinnedGroupRegistry((revision, cursor, limit) => router.read_group_registry_page(d.target.alias, revision, cursor, limit), undefined,
      () => { if (d.identity.getPrincipal().toText() !== binding.governor) throw new Error('Governor identity changed'); }) };
    const p = r.Ok.placements[0]; if (!p || r.Ok.groups.length !== r.Ok.placements.length || r.Ok.groups.length > 4096) throw new Error('Complete bounded group registry required');
    const signature = (v: typeof p) => JSON.stringify({ deployment: v.deployment_id, revision: String(v.deployment_revision), host: v.host,
      network: v.network_kind, primary: v.primary_subnet.toText(), additional: v.additional_subnets_enabled, approved: v.approved_subnets.map(s => s.toText()).sort() });
    if (p.deployment_id !== binding.deploymentId || p.host !== new URL(d.target.host).origin || p.network_kind !== d.target.networkKind ||
        r.Ok.placements.some(v => signature(v) !== signature(p)) || new Set(r.Ok.groups.map(g => g.id)).size !== r.Ok.groups.length)
      throw new Error('Mixed or foreign photo deployment');
    for (const g of r.Ok.groups) {
      const placement = r.Ok.placements.find(v => v.group_id === g.id);
      if (!placement || g.target_alias !== d.target.alias || new Set(g.domains.map(v => v.domain)).size !== g.domains.length ||
          new Set(placement.domains.map(v => v.domain)).size !== placement.domains.length || g.domains.length !== placement.domains.length ||
          g.domains.some(v => !placement.domains.some(w => w.domain === v.domain && w.canister.toText() === v.canister.toText())))
        throw new Error('Incomplete or mismatched group domain placement');
    }
    return r.Ok;
  };
  const first = await snapshot();
  const quota = new Map<string, Awaited<ReturnType<typeof connectLiveClubDomain>>['actor']>();
  for (const p of first.placements) {
    const club = p.domains.find(v => v.domain === 'club_domain'); if (!club) throw new Error('Missing quota authority');
    const id = club.canister.toText(); quota.set(id, (await connectLiveClubDomain(at('club_domain', id), d.identity)).actor);
  }
  const stores = new Map<string, ReturnType<typeof Actor.createActor<import('../lab/bindings/media_blob_store/declarations/media_blob_store.did')._SERVICE>>>();
  const registry = createMediaOperatorRegistry({ deploymentId: binding.deploymentId, host: new URL(d.target.host).origin }, {
    async readPlacement(): Promise<MediaRegistryPlacement> {
      const s = await snapshot(); const p = s.placements[0]; if (!p) throw new Error('Missing deployment');
      const inventory: MediaRegistryPlacement['stores'] = [];
      for (const group of s.placements) {
        const authority = group.domains.find(v => v.domain === 'club_domain')?.canister.toText(); if (!authority) throw new Error('Quota authority missing');
        for (const v of group.domains.filter(v => v.domain === 'media_blob_store' || v.domain.startsWith('media_blob_store:'))) {
          const id = v.canister.toText();
          const status = await CanisterStatus.request({ agent, canisterId: v.canister, paths: ['controllers', 'subnet'] });
          const controllers = status.get('controllers'); const subnet = status.get('subnet');
          if (!Array.isArray(controllers) || controllers.length !== 1 || !(controllers[0] instanceof Principal) || controllers[0].toText() !== binding.governor ||
              !subnet || typeof subnet !== 'object' || !('subnetId' in subnet) || subnet.subnetId !== v.subnet.toText())
            throw new Error('Certified store controller/subnet differs from approved deployment');
          inventory.push({ canisterId: id, quotaAuthority: authority, subnetId: v.subnet.toText() });
          if (!stores.has(id)) stores.set(id, Actor.createActor(storeIdl, { agent, canisterId: v.canister }));
        }
      }
      return { complete: true, revision: s.revision.toString(), deploymentId: p.deployment_id, host: p.host, stores: inventory,
        approvedSubnets: p.additional_subnets_enabled ? p.approved_subnets.map(v => v.toText()) : [p.primary_subnet.toText()] };
    },
    quotaActor(id) { const actor = quota.get(id); if (!actor) throw new Error('New quota authority requires operator restart'); return actor; },
    storeActor(id) { const actor = stores.get(id); if (!actor) throw new Error('Unknown media store'); return actor; },
  });
  const source = first.placements.find(p => p.group_id === binding.fromGroup);
  if (!source || !first.groups.some(g => g.id === binding.toGroup)) throw new Error('Source/destination group missing');
  const domainId = (name: string) => { const id = source.domains.find(v => v.domain === name)?.canister.toText(); if (!id) throw new Error(`Missing ${name} inventory`); return id; };
  const actors = {
    gallery: (await connectLiveMediaMetadata(at('media_metadata', domainId('media_metadata')), d.identity)).actor,
    chat: (await connectLiveMessagingDomain(at('messaging_domain', domainId('messaging_domain')), d.identity)).actor,
    vault: (await connectLiveVaultDomain(at('vault_domain', domainId('vault_domain')), d.identity)).actor,
    articles: (await connectLiveClubDomain(at('club_domain', domainId('club_domain')), d.identity)).actor,
  };
  const preparation = mediaTransferPreparation(binding, { readRegistry: registry, actor(id) { const actor = stores.get(id); if (!actor) throw new Error('Unknown store'); return actor; }, load: d.load, save: d.save });
  const inventory = reconciledMediaTransferInventory(binding, preparation, { async read(storage) {
    return { metadata: await readCompleteMediaMetadata(storage, { actors, readProvenance: d.readProvenance }),
      authorities: await d.readAuthorities(storage), sharedQuotaReady: true };
  } });
  return { preparation, inventory, readRegistry: registry };
}