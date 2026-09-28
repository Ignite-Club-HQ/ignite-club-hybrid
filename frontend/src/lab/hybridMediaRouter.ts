import type { Principal } from '@icp-sdk/core/principal';
import type { HybridBackend, PlacementRegistry } from './hybridClubLinksService';

export type MediaAsset = {
  id: string;
  clubId: string;
  kind: 'image' | 'document';
  name: string;
  bytes: number;
  status: 'uploaded' | 'blocked';
};

export type MediaClient = {
  upload: (asset: Omit<MediaAsset, 'status'>) => Promise<MediaAsset>;
  list: (clubId: string) => Promise<MediaAsset[]>;
  remove: (id: string) => Promise<void>;
};

export type MediaProviders = {
  supabase: (environment: string) => Promise<MediaClient>;
  icp: (canister: Principal) => Promise<MediaClient>;
};

const backendKey = (backend: HybridBackend) => 'Icp' in backend ? `icp:${backend.Icp.canister.toText()}` : `supabase:${backend.Supabase.environment}`;

export function createHybridMediaRouter(registry: PlacementRegistry, providers: MediaProviders) {
  const clients = new Map<string, MediaClient>();
  let disposed = false;
  const live = () => { if (disposed) throw new Error('Identity changed; operation discarded'); };

  const clientFor = async (backend: HybridBackend) => {
    live();
    const key = backendKey(backend);
    let client = clients.get(key);
    if (!client) {
      client = 'Icp' in backend ? await providers.icp(backend.Icp.canister) : await providers.supabase(backend.Supabase.environment);
      clients.set(key, client);
    }
    return client;
  };

  const route = async (clubId: string, write: boolean) => {
    const result = await registry.get_decision(clubId);
    if ('Err' in result || !result.Ok.length) throw new Error('Club has no backend placement');
    const decision = result.Ok[0];
    if (!decision.backend_enabled || !decision.country_allowed || (write && !decision.writable)) {
      throw new Error(`Media backend unavailable: ${decision.reason}`);
    }
    return clientFor(decision.placement.backend);
  };

  return {
    async upload(clubId: string, kind: 'image' | 'document', name: string, bytes: number) {
      const client = await route(clubId, true);
      return client.upload({ id: `${clubId}:${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`, clubId, kind, name, bytes });
    },
    async list(clubId: string) {
      const client = await route(clubId, false);
      return client.list(clubId);
    },
    async remove(clubId: string, id: string) {
      const client = await route(clubId, true);
      await client.remove(id);
    },
    dispose() {
      disposed = true;
      clients.clear();
    },
  };
}
