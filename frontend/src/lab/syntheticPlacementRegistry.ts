import type { HybridBackend, HybridDecision, PlacementRegistry } from './hybridClubLinksService';

export type SyntheticPlacementRegistry = PlacementRegistry & {
  setPlacement(clubId: string, country: string, backend: HybridBackend): void;
  setAvailability(backend: 'icp' | 'supabase', enabled: boolean): void;
  setState(clubId: string, state: HybridDecision['placement']['state'], reason?: string): void;
};

const backendName = (backend: HybridBackend): 'icp' | 'supabase' => 'Icp' in backend ? 'icp' : 'supabase';

/** Mutable in-memory control plane for hybrid integration tests. */
export function createSyntheticPlacementRegistry(initial: Array<{ clubId: string; country: string; backend: HybridBackend }> = []): SyntheticPlacementRegistry {
  const placements = new Map<string, HybridDecision['placement']>();
  const enabled = new Map<'icp' | 'supabase', boolean>([['icp', true], ['supabase', true]]);
  for (const item of initial) placements.set(item.clubId, { club_id: item.clubId, country: item.country, backend: item.backend, state: 'Active', version: 1n });
  return {
    async get_decision(clubId) {
      const placement = placements.get(clubId);
      if (!placement) return { Ok: [] };
      const backend_enabled = enabled.get(backendName(placement.backend)) ?? false;
      const country_allowed = placement.country.length === 2 && placement.country === placement.country.toUpperCase();
      const writable = backend_enabled && country_allowed && placement.state === 'Active';
      return { Ok: [{ placement, backend_enabled, country_allowed, writable, reason: !backend_enabled ? `${backendName(placement.backend)} disabled` : !country_allowed ? 'country policy denied' : placement.state === 'Active' ? 'active' : placement.state.toLowerCase(), }] };
    },
    setPlacement(clubId, country, backend) {
      const previous = placements.get(clubId);
      placements.set(clubId, { club_id: clubId, country, backend, state: previous?.state ?? 'Active', version: (previous?.version ?? 0n) + 1n });
    },
    setAvailability(backend, value) { enabled.set(backend, value); },
    setState(clubId, state, reason) {
      const placement = placements.get(clubId);
      if (!placement) throw new Error('Club has no backend placement');
      placements.set(clubId, { ...placement, state, version: placement.version + 1n, });
      void reason;
    },
  };
}
