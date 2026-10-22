import type { FeatureBackendContext } from './featureRouter';
import { readMembershipDiscovery } from './membershipDiscoveryCache';

/** Independent display inventories, never evidence of permission or placement. */
export function accountDiscoveryKey(ctx: FeatureBackendContext, source: string): string {
  return JSON.stringify([source, ctx.identity.getPrincipal().toText(), ctx.target?.alias,
    ctx.target?.host, ctx.target?.networkKind,
    Object.entries(ctx.target?.canisterIds ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
}

export function readAccountDiscovery<T>(ctx: FeatureBackendContext, source: string, load: () => Promise<T>): Promise<T> {
  return readMembershipDiscovery(accountDiscoveryKey(ctx, source), load);
}

export async function readDiscoveredMiniLeagues(ctx: FeatureBackendContext) {
  return readAccountDiscovery(ctx, 'mini-league-membership', async () => {
    const [{ clubDispatch }, { listMyLiveMiniLeagues }] = await Promise.all([
      import('./groupDispatch'), import('./features/miniLeagues'),
    ]);
    return clubDispatch.readAcross('mini_leagues', 'mini_league_domain', listMyLiveMiniLeagues,
      parts => [...new Map(parts.flat().map(row => [row.id, row])).values()], true);
  });
}

export async function readDiscoveredRemovedClubs(ctx: FeatureBackendContext) {
  return readAccountDiscovery(ctx, 'removed-clubs', async () => {
    const [{ clubDispatch }, { listLiveMyRemovedClubs }] = await Promise.all([
      import('./groupDispatch'), import('./features/club'),
    ]);
    return clubDispatch.readAcross('membership', 'club_domain', listLiveMyRemovedClubs,
      parts => [...new Map(parts.flat().map(row => [row.id, row])).values()], true);
  });
}