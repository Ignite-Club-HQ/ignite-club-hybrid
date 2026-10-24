import type { IcpTargetConfig } from "./targetRegistry";
import { ROUTING_GATES_SNAPSHOT } from "./generated/routingGates";
import type { RoutingGatesSnapshot } from "./generalActivation";

/** Public reads only. No membership session, router calls or write authority. */
export function publicReadTargets(base: IcpTargetConfig, snapshot: RoutingGatesSnapshot | null = ROUTING_GATES_SNAPSHOT): IcpTargetConfig[] {
  if (!snapshot) return [base];
  if (snapshot.host !== base.host || snapshot.routerCanisterId !== base.canisterIds.shard_router) {
    throw new Error("Public group inventory does not match this deployment");
  }
  const targets = [base, ...snapshot.groups.map(group => ({
    ...base, canisterIds: { ...base.canisterIds, ...Object.fromEntries(group.domains.map(d => [d.domain, d.canisterId])) },
  }))];
  return [...new Map(targets.map(t => [JSON.stringify(Object.entries(t.canisterIds).sort()), t])).values()];
}

export async function readUniquePublicGroup<T>(base: IcpTargetConfig, read: (target: IcpTargetConfig) => Promise<T | null>): Promise<T | null> {
  const rows = await Promise.all(publicReadTargets(base).map(read));
  const found = rows.filter((row): row is T => row !== null);
  if (found.length > 1) throw new Error("Public resource has multiple owners");
  return found[0] ?? null;
}