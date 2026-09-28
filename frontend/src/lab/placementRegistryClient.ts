import type { _SERVICE, result_decision } from './bindings/placement_registry/declarations/placement_registry.did.js';
import type { HybridDecision, PlacementRegistry } from './hybridClubLinksService';

function state(value: { Active?: null; ReadOnly?: null; MigrationRequired?: null; Blocked?: null }): HybridDecision['placement']['state'] {
  if ('Active' in value) return 'Active';
  if ('ReadOnly' in value) return 'ReadOnly';
  if ('MigrationRequired' in value) return 'MigrationRequired';
  return 'Blocked';
}

function convert(result: result_decision): { Ok: [] | [HybridDecision] } | { Err: string } {
  if ('Err' in result) return result;
  if (!result.Ok.length) return { Ok: [] };
  const decision = result.Ok[0];
  return {
    Ok: [{
      backend_enabled: decision.backend_enabled,
      country_allowed: decision.country_allowed,
      writable: decision.writable,
      reason: decision.reason,
      placement: {
        club_id: decision.placement.club_id,
        country: decision.placement.country,
        version: decision.placement.version,
        state: state(decision.placement.state),
        backend: decision.placement.backend,
      },
    }],
  };
}

/** Adapts the generated local Candid actor to the provider-neutral registry seam. */
export function createPlacementRegistryClient(actor: _SERVICE): PlacementRegistry {
  return { get_decision: async clubId => convert(await actor.get_decision(clubId)) };
}
