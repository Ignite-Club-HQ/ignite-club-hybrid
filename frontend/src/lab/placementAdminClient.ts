import type { _SERVICE, backend, operator_role, placement, policy, result_placement, result_policy, result_site_availability, result_target, residency_policy, site_availability, target } from './bindings/placement_registry/declarations/placement_registry.did.js';

export type PlacementAdminRegistry = {
  getPolicy(country: string): Promise<policy>;
  setPolicy(country: string, supabaseEnabled: boolean, icpEnabled: boolean, expectedVersion: bigint): Promise<policy>;
  setTarget(input: { alias: string; siteId?: string; profile: string; backend: backend; deploymentClass: string; enabled: boolean; expectedVersion: bigint }): Promise<target>;
  setSiteAvailability(siteId: string, enabled: boolean, expectedVersion: bigint): Promise<site_availability>;
  setPlacement(clubId: string, country: string, backend: backend, expectedVersion: bigint): Promise<placement>;
  setResidencyPolicy(country: string, profiles: string[], expectedVersion: bigint): Promise<residency_policy>;
  listAudit(startAfter: bigint | undefined, limit: number): ReturnType<_SERVICE['list_audit']>;
};

function unwrap<T>(result: { Ok: T } | { Err: string }): T {
  if ('Err' in result) throw new Error(result.Err);
  return result.Ok;
}

export function createPlacementAdminClient(actor: _SERVICE): PlacementAdminRegistry {
  return {
    getPolicy: async country => unwrap(await actor.get_policy(country)),
    setPolicy: async (country, supabaseEnabled, icpEnabled, expectedVersion) => unwrap(await actor.set_policy(country, supabaseEnabled, icpEnabled, expectedVersion)),
    setTarget: async input => unwrap(await actor.set_target(input.alias, input.siteId ? [input.siteId] : [], input.profile, input.backend, input.deploymentClass, input.enabled, input.expectedVersion)),
    setSiteAvailability: async (siteId, enabled, expectedVersion) => unwrap(await actor.set_site_availability(siteId, enabled, expectedVersion)),
    setPlacement: async (clubId, country, backend, expectedVersion) => unwrap(await actor.set_placement(clubId, country, backend, expectedVersion)),
    setResidencyPolicy: async (country, profiles, expectedVersion) => unwrap(await actor.set_residency_policy(country, profiles, expectedVersion)),
    listAudit: (startAfter, limit) => actor.list_audit(startAfter === undefined ? [] : [startAfter], limit),
  };
}

export function operatorRole(role: 'placement' | 'security' | 'infrastructure' | 'migration' | 'audit'): operator_role {
  return role === 'placement' ? { PlacementAdmin: null } : role === 'security' ? { SecurityAdmin: null } : role === 'infrastructure' ? { InfrastructureAdmin: null } : role === 'migration' ? { MigrationOperator: null } : { Auditor: null };
}

export function resultError(result: result_policy | result_target | result_placement | result_site_availability): string | undefined {
  return 'Err' in result ? result.Err : undefined;
}
