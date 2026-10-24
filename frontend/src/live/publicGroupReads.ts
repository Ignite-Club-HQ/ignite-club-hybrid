import type { IcpTargetConfig } from "./targetRegistry";
import { ROUTING_GATES_SNAPSHOT } from "./generated/routingGates";
import type { RoutingGatesSnapshot } from "./generalActivation";

/** Build-anchored fallback inventory only; never a membership/write grant. */
export function publicReadTargets(base: IcpTargetConfig, snapshot: RoutingGatesSnapshot | null = ROUTING_GATES_SNAPSHOT): IcpTargetConfig[] {
  if (!snapshot) return [base];
  if (!base.canisterIds.shard_router) return [base];
  if (snapshot.host !== base.host || snapshot.routerCanisterId !== base.canisterIds.shard_router) {
    throw new Error("Public group inventory does not match this deployment");
  }
  const targets = [base, ...snapshot.groups.map(group => ({
    ...base, canisterIds: { ...base.canisterIds, ...Object.fromEntries(group.domains.map(d => [d.domain, d.canisterId])) },
  }))];
  return [...new Map(targets.map(t => [JSON.stringify(Object.entries(t.canisterIds).sort()), t])).values()];
}

export async function readUniquePublicGroup<T>(base: IcpTargetConfig, read: (target: IcpTargetConfig) => Promise<T | null>): Promise<T | null> {
  const rows = await Promise.all((await readFreshPublicTargets(base)).map(read));
  const found = rows.filter((row): row is T => row !== null);
  if (found.length > 1) throw new Error("Public resource has multiple owners");
  return found[0] ?? null;
}

export async function readFreshPublicTargets(base: IcpTargetConfig, snapshot = ROUTING_GATES_SNAPSHOT): Promise<IcpTargetConfig[]> {
  if (!snapshot || !base.canisterIds.shard_router) return [base];
  // The build anchors only the deployment, never the lifetime group set.
  publicReadTargets(base,snapshot);
  const [{AnonymousIdentity},{connectLiveShardRouter}] = await Promise.all([import("@icp-sdk/core/agent"),import("./domains")]);
  const {actor}=await connectLiveShardRouter(base,new AnonymousIdentity());
  let revision:bigint|undefined;let cursor:[]|[string]=[];
  const groups:Array<{id:string;domains:Array<{domain:string;canister:{toText():string}}>}> = [];
  const domains=new Set(["club_domain","events_domain","messaging_domain","vault_domain","competition_domain","club_points_domain","mini_league_domain","media_metadata","insights_domain","notification_queue","pii_access_control","timer_jobs","secret_workload_identity"]);
  for(let page=0;page<64;page++) {
    const reply=await actor.read_public_group_targets(snapshot.targetAlias,revision===undefined?[]:[revision],cursor,64);
    if("Err" in reply)throw new Error(reply.Err);
    const row=reply.Ok;revision??=row.configuration_revision;
    if(row.configuration_revision!==revision || row.groups.length>64)throw new Error("Public group revision changed");
    for(const group of row.groups) {
      if(groups.some(g=>g.id===group.id) || group.domains.length!==13 || new Set(group.domains.map(d=>d.domain)).size!==13 || group.domains.some(d=>!domains.has(d.domain)))throw new Error("Incomplete public group inventory");
      groups.push(group);
    }
    if(!row.next_cursor.length) {
      const targets=[base,...groups.map(group=>({...base,canisterIds:{...base.canisterIds,...Object.fromEntries(group.domains.map(d=>[d.domain,d.canister.toText()]))}}))];
      return [...new Map(targets.map(t=>[t.canisterIds.competition_domain,t])).values()];
    }
    if(cursor.length && row.next_cursor[0]<=cursor[0])throw new Error("Public group cursor did not advance");
    cursor=row.next_cursor;
  }
  throw new Error("Public group inventory exceeds bound");
}