/** Pure group/canister utilization model for the admin Group Infrastructure
 * page (the single canonical live-utilization view — see AGENTS.md).
 *
 * Group inventory comes from the governor-verified routing snapshot plus the
 * shared ("Group 1") deployment ID table; live readings come from each
 * canister's public `cycles_balance` / `memory_stats` queries. Everything here
 * is pure and fail-closed: a missing reading is reported, never invented. */
import type { RoutingGatesSnapshot } from './generalActivation';

/** Global control-plane services: not part of any club group. */
export const CONTROL_PLANE_KEYS = ['placement_registry', 'shard_router', 'migration_coordinator'] as const;

export type CanisterSpec = { key: string; canisterId: string };

export type GroupSpec = {
  id: string;
  label: string;
  /** null = not tracked on-chain (the shared group predates the router). */
  accepting: boolean | null;
  maxClubs: number | null;
  canisters: CanisterSpec[];
  photoStoreId: string | null;
  /** Tested usable bytes per canister key; empty when no load-test figures exist. */
  testedLimitBytes: Record<string, number>;
};

export type CanisterReading = {
  key: string;
  canisterId: string;
  memoryBytes: number | null;
  cyclesT: number | null;
  clubs: number | null; // only set on club_domain rows
  error: string | null;
};

export type PhotoStoreReading = {
  totalBytes: number;
  limitBytes: number;
  accepting: boolean;
  error: string | null;
};

export type GroupRollup = {
  memoryBytes: number;
  /** Summed tested limits across canisters that have one; null when none do. */
  testedLimitBytes: number | null;
  memoryPct: number | null;
  minCyclesT: number | null;
  unreadable: string[];
};

export const LOW_FUEL_T = 1;
/** Advisory flag when a canister has no tested limit recorded. */
export const WARN_MEMORY_MB = 3000;

type ApprovedConfigurationGroup = {
  id: string;
  accepting?: boolean;
  maxClubs?: number;
  domains?: { domain: string; canisterId: string }[];
};

/** Parses the snapshot's approved configuration JSON; returns [] on any
 * mismatch rather than guessing at group policy. */
export function parseApprovedConfiguration(raw: string | undefined): ApprovedConfigurationGroup[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((g): g is ApprovedConfigurationGroup => !!g && typeof g.id === 'string');
  } catch {
    return [];
  }
}

/**
 * Builds the group list the panel shows:
 * - "Group 1 — shared services": the original deployment's domain canisters
 *   (control-plane services are split out, they serve every group).
 * - One entry per router group in the verified routing snapshot.
 */
export function buildGroupSpecs(args: {
  snapshot: RoutingGatesSnapshot | null;
  sharedCanisterIds: Record<string, string>;
  /** Tested limits per group id (browser copy of deploy/groups/tested-limits.json). */
  testedLimits: Record<string, Record<string, number>>;
}): { groups: GroupSpec[]; globalCanisters: CanisterSpec[] } {
  const { snapshot, sharedCanisterIds, testedLimits } = args;
  const globalCanisters: CanisterSpec[] = CONTROL_PLANE_KEYS
    .filter((k) => sharedCanisterIds[k])
    .map((k) => ({ key: k, canisterId: sharedCanisterIds[k] }));

  const sharedCanisters = Object.entries(sharedCanisterIds)
    .filter(([k]) => !(CONTROL_PLANE_KEYS as readonly string[]).includes(k))
    .map(([key, canisterId]) => ({ key, canisterId }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const groups: GroupSpec[] = [];
  if (sharedCanisters.length) {
    groups.push({
      id: 'g1',
      label: 'Group 1 — shared services',
      accepting: null,
      maxClubs: null,
      canisters: sharedCanisters,
      photoStoreId: sharedCanisterIds['media_blob_store'] ?? null,
      testedLimitBytes: testedLimits['g1'] ?? {},
    });
  }

  const approved = new Map(parseApprovedConfiguration(snapshot?.approvedConfiguration).map((g) => [g.id, g]));
  for (const g of snapshot?.groups ?? []) {
    const policy = approved.get(g.id);
    groups.push({
      id: g.id,
      label: `Group ${g.id.replace(/^g/, '')} — router group ${g.id}`,
      accepting: policy?.accepting ?? null,
      maxClubs: typeof policy?.maxClubs === 'number' ? policy.maxClubs : null,
      canisters: g.domains
        .map((d) => ({ key: d.domain, canisterId: d.canisterId }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      photoStoreId: g.photoStore,
      testedLimitBytes: testedLimits[g.id] ?? {},
    });
  }
  return { groups, globalCanisters };
}

/** Group-level rollup from per-canister readings. Unreadable canisters are
 * listed, never silently treated as zero. */
export function computeGroupRollup(readings: CanisterReading[], spec: GroupSpec): GroupRollup {
  const byKey = new Map(readings.map((r) => [r.key, r]));
  let memoryBytes = 0;
  let testedLimitBytes = 0;
  let anyLimit = false;
  let minCyclesT: number | null = null;
  const unreadable: string[] = [];
  for (const c of spec.canisters) {
    const r = byKey.get(c.key);
    if (!r || r.error || r.memoryBytes == null || r.cyclesT == null) {
      unreadable.push(c.key);
      continue;
    }
    memoryBytes += r.memoryBytes;
    const limit = spec.testedLimitBytes[c.key];
    if (typeof limit === 'number' && limit > 0) {
      testedLimitBytes += limit;
      anyLimit = true;
    }
    if (minCyclesT == null || r.cyclesT < minCyclesT) minCyclesT = r.cyclesT;
  }
  return {
    memoryBytes,
    testedLimitBytes: anyLimit ? testedLimitBytes : null,
    memoryPct: anyLimit && testedLimitBytes > 0 ? (memoryBytes / testedLimitBytes) * 100 : null,
    minCyclesT,
    unreadable,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatT(v: number): string {
  return v >= 10 ? v.toFixed(1) : v.toFixed(2);
}
