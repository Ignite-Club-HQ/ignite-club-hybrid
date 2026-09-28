import type { Principal } from '@icp-sdk/core/principal';
import type { _SERVICE } from './bindings/declarations/club_links.did.js';
import { createIcpClubLinksService } from './icpClubLinksService';
import type { ClubLink, ClubLinksService } from './ClubLinksService';

type Route = { club_id: string; revision: bigint; shard: Principal };
type Router = { get_route(club: string): Promise<{ Ok: [] | [Route] } | { Err: string }> };
type ActorFactory = (shard: Principal) => Promise<_SERVICE>;

function routeError(result: { Ok: [] | [Route] } | { Err: string }): Route {
  if ('Err' in result) throw new Error(result.Err);
  if (!result.Ok.length) throw new Error('Club has no shard route');
  return result.Ok[0];
}

function shouldRefreshRoute(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /route|shard|stale/i.test(message);
}

/**
 * Route-aware adapter for the local shard-router POC. The router selects a
 * domain canister; each domain canister still authenticates the signed caller.
 */
export function createRoutedClubLinksService(router: Router, actorFactory: ActorFactory): ClubLinksService & { dispose(): void } {
  const services = new Map<string, ClubLinksService & { dispose(): void }>();
  const scopes = new Map<string, string>();
  let disposed = false;
  const live = () => { if (disposed) throw new Error('Identity changed; operation discarded'); };
  const serviceFor = async (route: Route) => {
    live();
    let service = services.get(route.shard.toText());
    if (!service) {
      service = createIcpClubLinksService(await actorFactory(route.shard));
      services.set(route.shard.toText(), service);
    }
    return service;
  };
  const withRoute = async <T>(club: string, action: (service: ClubLinksService) => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const route = routeError(await router.get_route(club));
      try { return await action(await serviceFor(route)); }
      catch (error) {
        if (attempt === 0 && shouldRefreshRoute(error)) continue;
        throw error;
      }
    }
    throw new Error('Route retry exhausted');
  };
  const remember = (club: string, links: ClubLink[]) => { for (const link of links) scopes.set(link.id, club); return links; };
  return {
    listAdmin: club => withRoute(club, service => service.listAdmin(club)).then(links => remember(club, links)),
    listVisible: club => withRoute(club, service => service.listVisible(club)).then(links => remember(club, links)),
    async get(id) {
      live();
      const club = scopes.get(id);
      if (!club) throw new Error('Unknown link scope; load the club listing first');
      return withRoute(club, service => service.get(id));
    },
    async save(club, draft) {
      const result = await withRoute(club, service => service.save(club, draft));
      scopes.set(result.id, club);
      return result;
    },
    async remove(id, expectedRevision) {
      const club = scopes.get(id);
      if (!club) throw new Error('Unknown link scope; load the club listing first');
      await withRoute(club, service => service.remove(id, expectedRevision));
      scopes.delete(id);
    },
    async setActive(id, active, expectedRevision) {
      const club = scopes.get(id);
      if (!club) throw new Error('Unknown link scope; load the club listing first');
      await withRoute(club, service => service.setActive(id, active, expectedRevision));
    },
    reorder: (club, first, second, expectedRevision) => withRoute(club, service => service.reorder(club, first, second, expectedRevision)),
    dispose() { disposed = true; scopes.clear(); for (const service of services.values()) service.dispose(); services.clear(); },
  };
}
