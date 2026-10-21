import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';

type DeletionDomain = 'club_domain' | 'vault_domain' | 'events_domain' | 'messaging_domain';

/** Keep discovery alive through deletion: membership loss must not drop an authority on retry. */
export async function openAccountDeletionInventory(target: IcpTargetConfig, identity: Identity,
  required: readonly DeletionDomain[]) {
  const { activationStatus, SHIPPED_GATES } = await import('./groupActivation');
  const owner = activationStatus(SHIPPED_GATES).active ? null : await (await import('./ownerTestRouting')).readOwnerTestRoute({ target, identity });
  const grouped = activationStatus(SHIPPED_GATES).active || Boolean(owner);
  const session = grouped
    ? await (await import('./groupSessionLive')).openLiveGroupReadSession({ target, identity }, owner?.groupId)
    : undefined;
  try {
    const targets = session
      ? [target, ...await session.readEveryGroup('club_domain', async ctx => [ctx.target], 4096)]
      : [target];
    const byDomain = new Map<DeletionDomain, IcpTargetConfig[]>();
    for (const domain of required) {
      const seen = new Set<string>();
      byDomain.set(domain, targets.filter(t => {
        const id = t.canisterIds?.[domain];
        if (grouped && !id) throw new Error(`Account erasure requires ${domain} for every registered group`);
        const key = JSON.stringify([t.host, t.networkKind, id]);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }));
    }
    return {
      revision: session?.deletionRegistryRevision,
      targetsFor: (domain: DeletionDomain) => byDomain.get(domain) ?? [],
      // Point-in-time consensus check, NOT an atomic cross-canister erasure fence.
      validate: async () => { if (session) await session.assertRegistryUnchanged(); },
      dispose: () => session?.dispose(),
    };
  } catch (error) { session?.dispose(); throw error; }
}