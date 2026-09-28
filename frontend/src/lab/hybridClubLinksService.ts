import type { Principal } from '@icp-sdk/core/principal';
import type { ClubLink, ClubLinksService } from './ClubLinksService';

export type HybridBackend =
  | { Icp: { canister: Principal } }
  | { Supabase: { environment: string } };

export type HybridDecision = {
  backend_enabled: boolean;
  country_allowed: boolean;
  placement: { club_id: string; country: string; backend: HybridBackend; state: 'Active' | 'ReadOnly' | 'MigrationRequired' | 'Blocked'; version: bigint };
  writable: boolean;
  reason: string;
};

export type PlacementRegistry = {
  get_decision(clubId: string): Promise<{ Ok: [] | [HybridDecision] } | { Err: string }>;
};

export type HybridProviders = {
  supabase: (environment: string) => Promise<ClubLinksService & { dispose?: () => void }>;
  icp: (canister: Principal) => Promise<ClubLinksService & { dispose?: () => void }>;
};

function decisionError(result: { Ok: [] | [HybridDecision] } | { Err: string }): HybridDecision {
  if ('Err' in result) throw new Error(`Placement lookup failed: ${result.Err}`);
  if (!result.Ok.length) throw new Error('Club has no backend placement');
  return result.Ok[0];
}

function backendKey(backend: HybridBackend): string {
  if ('Icp' in backend) return `icp:${backend.Icp.canister.toText()}`;
  return `supabase:${backend.Supabase.environment}`;
}

/**
 * Provider-neutral boundary for a permanently hybrid deployment.
 * Placement is authoritative for every operation; this adapter never falls
 * back to another backend when the selected one is unavailable or disallowed.
 */
export function createHybridClubLinksService(
  registry: PlacementRegistry,
  providers: HybridProviders,
): ClubLinksService & { dispose(): void } {
  const services = new Map<string, ClubLinksService & { dispose?: () => void }>();
  const scopes = new Map<string, string>();
  let disposed = false;
  const live = () => { if (disposed) throw new Error('Identity changed; operation discarded'); };

  const getDecision = async (clubId: string): Promise<HybridDecision> => {
    live();
    const decision = decisionError(await registry.get_decision(clubId));
    const blockedState = decision.placement.state === 'Blocked' || decision.placement.state === 'MigrationRequired';
    if (!decision.backend_enabled || !decision.country_allowed || blockedState) {
      throw new Error(`Backend unavailable for club ${clubId}: ${decision.reason}`);
    }
    return decision;
  };

  const serviceFor = async (backend: HybridBackend) => {
    live();
    const key = backendKey(backend);
    let service = services.get(key);
    if (!service) {
      service = 'Icp' in backend
        ? await providers.icp(backend.Icp.canister)
        : await providers.supabase(backend.Supabase.environment);
      services.set(key, service);
    }
    return service;
  };

  const withClub = async <T>(clubId: string, write: boolean, action: (service: ClubLinksService) => Promise<T>): Promise<T> => {
    const decision = await getDecision(clubId);
    if (write && !decision.writable) throw new Error(`Club is not writable: ${decision.reason}`);
    return action(await serviceFor(decision.placement.backend));
  };

  const scope = async (id: string): Promise<string> => {
    live();
    const club = scopes.get(id);
    if (!club) throw new Error('Unknown link scope; load the club listing first');
    return club;
  };
  const remember = (club: string, links: ClubLink[]) => {
    for (const link of links) scopes.set(link.id, club);
    return links;
  };

  return {
    listAdmin: club => withClub(club, false, service => service.listAdmin(club).then(links => remember(club, links))),
    listVisible: club => withClub(club, false, service => service.listVisible(club).then(links => remember(club, links))),
    get: async id => {
      const club = await scope(id);
      return withClub(club, false, service => service.get(id));
    },
    save: async (club, draft) => {
      const link = await withClub(club, true, service => service.save(club, draft));
      scopes.set(link.id, club);
      return link;
    },
    remove: async (id, expectedRevision) => {
      const club = await scope(id);
      await withClub(club, true, service => service.remove(id, expectedRevision));
      scopes.delete(id);
    },
    setActive: async (id, active, expectedRevision) => {
      const club = await scope(id);
      return withClub(club, true, service => service.setActive(id, active, expectedRevision));
    },
    reorder: (club, first, second, expectedRevision) => withClub(club, true, service => service.reorder(club, first, second, expectedRevision)),
    dispose() {
      disposed = true;
      scopes.clear();
      for (const service of services.values()) service.dispose?.();
      services.clear();
    },
  };
}
