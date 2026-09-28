import type { Principal } from '@icp-sdk/core/principal';
import type { HybridBackend, PlacementRegistry } from './hybridClubLinksService';

type MessageClient = {
  send: (message: { id: string; clubId: string; threadId: string; body: string }) => Promise<{ id: string; clubId: string; threadId: string; body: string; sequence: number; status: 'queued' | 'delivered' }>;
  list: (clubId: string, threadId: string) => Promise<Array<{ id: string; clubId: string; threadId: string; body: string; sequence: number; status: 'queued' | 'delivered' }>>;
  listAfter?: (clubId: string, threadId: string, afterSequence: number) => Promise<Array<{ id: string; clubId: string; threadId: string; body: string; sequence: number; status: 'queued' | 'delivered' }>>;
};

export type HybridMessageProviders = {
  supabase: (environment: string) => Promise<MessageClient>;
  icp: (canister: Principal) => Promise<MessageClient>;
};

function backendKey(backend: HybridBackend): string {
  if ('Icp' in backend) return `icp:${backend.Icp.canister.toText()}`;
  return `supabase:${backend.Supabase.environment}`;
}

/** Message routing uses the same placement authority as other domain reads and writes. */
export function createHybridMessageRouter(registry: PlacementRegistry, providers: HybridMessageProviders) {
  const clients = new Map<string, MessageClient>();
  let disposed = false;
  const live = () => { if (disposed) throw new Error('Identity changed; operation discarded'); };

  const getDecision = async (clubId: string) => {
    live();
    const result = await registry.get_decision(clubId);
    if ('Err' in result || !result.Ok.length) throw new Error('Club has no backend placement');
    const decision = result.Ok[0];
    if (!decision.backend_enabled || !decision.country_allowed) {
      throw new Error(`Message backend unavailable: ${decision.reason}`);
    }
    return decision;
  };

  const clientFor = async (backend: HybridBackend) => {
    const key = backendKey(backend);
    let client = clients.get(key);
    if (!client) {
      client = 'Icp' in backend ? await providers.icp(backend.Icp.canister) : await providers.supabase(backend.Supabase.environment);
      clients.set(key, client);
    }
    return client;
  };

  const route = async (clubId: string, write: boolean) => {
    const decision = await getDecision(clubId);
    if (write && !decision.writable) throw new Error(`Message backend unavailable: ${decision.reason}`);
    return clientFor(decision.placement.backend);
  };

  return {
    async send(clubId: string, threadId: string, body: string, id = `${clubId}:${threadId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`) {
      const client = await route(clubId, true);
      return client.send({ id, clubId, threadId, body });
    },
    async list(clubId: string, threadId: string) {
      const client = await route(clubId, false);
      return client.list(clubId, threadId);
    },
    async listAfter(clubId: string, threadId: string, afterSequence: number) {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error('Invalid message sequence');
      const client = await route(clubId, false);
      if (client.listAfter) return client.listAfter(clubId, threadId, afterSequence);
      return (await client.list(clubId, threadId)).filter(message => message.sequence > afterSequence);
    },
    dispose() {
      disposed = true;
      clients.clear();
    },
  };
}
