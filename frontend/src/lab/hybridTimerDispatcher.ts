import type { TimerJob } from './syntheticTimerQueue';
import type { Principal } from '@icp-sdk/core/principal';
import type { HybridBackend, PlacementRegistry } from './hybridClubLinksService';
import type { TimerJobsClient } from './timerJobsClient';

type Providers = {
  icp: (canister: Principal) => Promise<TimerJobsClient>;
  supabase: (environment: string) => Promise<TimerJobsClient>;
};

/** Routes durable jobs by the same authoritative club placement as domain data. */
export function createHybridTimerDispatcher(registry: PlacementRegistry, providers: Providers) {
  const clients = new Map<string, TimerJobsClient>();
  const clientFor = async (backend: HybridBackend) => {
    const key = 'Icp' in backend ? `icp:${backend.Icp.canister.toText()}` : `supabase:${backend.Supabase.environment}`;
    const existing = clients.get(key); if (existing) return existing;
    const client = 'Icp' in backend ? await providers.icp(backend.Icp.canister) : await providers.supabase(backend.Supabase.environment);
    clients.set(key, client); return client;
  };
  const decision = async (clubId: string, write: boolean) => {
    const result = await registry.get_decision(clubId);
    if ('Err' in result || !result.Ok.length) throw new Error('Club has no backend placement');
    const value = result.Ok[0];
    if (!value.backend_enabled || !value.country_allowed || (write && !value.writable)) throw new Error(`Timer backend unavailable: ${value.reason}`);
    return value;
  };
  return {
    async schedule(job: Pick<TimerJob, 'id' | 'scope' | 'runAtMs' | 'idempotencyKey'>) { const d = await decision(job.scope, true); return (await clientFor(d.placement.backend)).schedule(job); },
    async claim(clubId: string, nowMs: number, limit: number) { const d = await decision(clubId, true); return (await clientFor(d.placement.backend)).claim(nowMs, limit); },
    async complete(clubId: string, id: string, key: string) { const d = await decision(clubId, true); return (await clientFor(d.placement.backend)).complete(id, key); },
    async fail(clubId: string, id: string, error: string, retryAtMs?: number) { const d = await decision(clubId, true); return (await clientFor(d.placement.backend)).fail(id, error, retryAtMs); },
  };
}
