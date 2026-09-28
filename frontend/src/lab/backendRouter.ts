import type { HybridBackend, HybridDecision, PlacementRegistry } from './hybridClubLinksService';
import type { Principal } from '@icp-sdk/core/principal';

export type RoutedBackend = {
  kind: 'icp' | 'supabase';
  backend: HybridBackend;
  decision: HybridDecision;
};

export type BackendProviders<T> = {
  icp: (canister: Principal) => Promise<T>;
  supabase: (environment: string) => Promise<T>;
};

function decisionError(result: { Ok: [] | [HybridDecision] } | { Err: string }): HybridDecision {
  if ('Err' in result) throw new Error(`Placement lookup failed: ${result.Err}`);
  if (result.Ok.length === 0) throw new Error('Club has no backend placement');
  const decision = result.Ok[0];
  const blockedState = decision.placement.state === 'Blocked' || decision.placement.state === 'MigrationRequired';
  if (!decision.backend_enabled || !decision.country_allowed || blockedState) {
    throw new Error(`Backend unavailable for club: ${decision.reason}`);
  }
  return decision;
}

export async function resolveClubBackend(
  registry: PlacementRegistry,
  clubId: string,
): Promise<RoutedBackend> {
  const decision = decisionError(await registry.get_decision(clubId));
  return {
    kind: 'Icp' in decision.placement.backend ? 'icp' : 'supabase',
    backend: decision.placement.backend,
    decision,
  };
}

export async function withClubBackend<T>(
  registry: PlacementRegistry,
  providers: BackendProviders<T>,
  clubId: string,
  operation: (provider: T, routed: RoutedBackend) => Promise<T> | T,
): Promise<T> {
  const routed = await resolveClubBackend(registry, clubId);
  const provider = 'Icp' in routed.backend
    ? await providers.icp(routed.backend.Icp.canister)
    : await providers.supabase(routed.backend.Supabase.environment);
  return operation(provider, routed);
}
