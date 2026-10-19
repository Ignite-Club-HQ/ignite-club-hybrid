/** Turns live per-service readings (canister-health HEALTH_JSON_OUT) plus the
 * operator's tested limits into deployment-bound capacity evidence. Pure and
 * fail-closed: any missing reading or limit yields no evidence. */
import type { GroupCapacity } from './groupPlacement';
import { LOW_FUEL_T } from './groupCapacityFuel';

/** club_domain's row may carry the live club count from its public usage_stats. */
export type HealthRow = { name: string; memory_mb: number | null; cycles_t: number | null; clubs?: number };
export type TestedLimits = {
  deploymentId: string; groupId: string; subnetId: string;
  /** Usable bytes per service, from load tests or app admission budgets — never ICP headline limits. */
  storageLimitBytes: Record<string, number>;
  /** Optional extra resources (e.g. processing, clubs) with tested limits and current use. */
  extra?: { resource: string; used: number; testedLimit: number; evidence: string }[];
  clubCount: number;
};

export function collectGroupCapacity(rows: HealthRow[], limits: TestedLimits, nowMs: number):
  { group: GroupCapacity | null; problems: string[] } {
  const problems: string[] = [];
  const byName = new Map(rows.map(r => [r.name, r]));
  const readings = Object.entries(limits.storageLimitBytes).map(([svc, limit]) => {
    const r = byName.get(svc);
    if (!r || r.memory_mb == null || !Number.isFinite(r.memory_mb)) problems.push(`${svc}: no memory reading`);
    if (!Number.isFinite(limit) || limit <= 0) problems.push(`${svc}: no tested limit`);
    return { resource: `storage:${svc}`, used: (r?.memory_mb ?? NaN) * 1e6, testedLimit: limit, evidence: 'memory_stats query' };
  });
  if (!readings.length) problems.push('no tested limits configured');
  const live = byName.get('club_domain')?.clubs;
  const clubCount = live !== undefined && Number.isInteger(live) && live >= 0 ? live : limits.clubCount;
  if (!Number.isInteger(clubCount) || clubCount < 0) problems.push('club count required');
  const all = [...readings, ...(limits.extra ?? [])];
  const fuelRows = rows.filter(r => limits.storageLimitBytes[r.name] !== undefined);
  const cyclesHealthy = fuelRows.length === readings.length &&
    fuelRows.every(r => r.cycles_t != null && r.cycles_t >= LOW_FUEL_T);
  if (problems.length) return { group: null, problems };
  return { problems, group: {
    groupId: limits.groupId, deploymentId: limits.deploymentId, subnetId: limits.subnetId, enabled: true,
    clubs: clubCount, maxDomainBytes: Math.max(...readings.map(r => r.used)), dailyGrowthBytes: 0,
    cyclesHealthy, ready: true,
    capacity: { deploymentId: limits.deploymentId, observedAtMs: nowMs, readings: all,
      requiredResources: all.map(r => r.resource) },
  } };
}
