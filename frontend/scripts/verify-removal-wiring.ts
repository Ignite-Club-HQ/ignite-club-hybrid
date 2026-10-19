/** Operator check before opening: reads every registered group's services'
 * own settings (controller-only) and writes removal-wiring evidence bound to
 * the router's current registry revision. Changes nothing on-chain.
 * Usage: tsx scripts/verify-removal-wiring.ts <operator.pem> <evidence.json>
 * Env: ICP_HOST (default https://icp-api.io), TARGET_ALIAS (default ic). */
import { writeFileSync } from 'node:fs';
import { HttpAgent, Actor } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { verifyRemovalWiring } from '../src/live/groupRemovalWiring';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { DEPLOYED_MAINNET_CANISTER_IDS as LIVE } from '../src/live/generated/deployedCanisterIds';
import type { GroupDomain } from '../src/live/groupRouting';

const [pem, out] = process.argv.slice(2);
if (!pem || !out) throw new Error('Usage: verify-removal-wiring <operator.pem> <evidence.json>');
const identity = loadOperatorIdentity(pem);
const agent = await HttpAgent.create({ host: process.env.ICP_HOST || 'https://icp-api.io', identity });
const router = Actor.createActor(routerIdl, { agent, canisterId: LIVE.shard_router }) as any;
const reply = await router.read_group_registry(process.env.TARGET_ALIAS || 'ic');
if ('Err' in reply) throw new Error(reply.Err);
const groups = reply.Ok.groups.map((g: any) => ({ id: g.id, targetAlias: g.target_alias, photoStore: g.photo_store[0]?.toText(),
  domains: g.domains.map((d: any) => ({ domain: d.domain as GroupDomain, canisterId: d.canister.toText() })) }));
const mgmtIdl = ({ IDL: I }: { IDL: typeof IDL }) => I.Service({ canister_status: I.Func([I.Record({ canister_id: I.Principal })],
  [I.Record({ settings: I.Record({ environment_variables: I.Vec(I.Record({ name: I.Text, value: I.Text })) }) })], []) });
const read = async (id: string) => {
  const m = Actor.createActor(mgmtIdl as never, { agent, canisterId: Principal.fromText('aaaaa-aa'), effectiveCanisterId: Principal.fromText(id) }) as any;
  return (await m.canister_status({ canister_id: Principal.fromText(id) })).settings.environment_variables;
};
const { evidence, problems } = await verifyRemovalWiring({ revision: reply.Ok.revision, groups }, LIVE.identity_access, read, Date.now());
if (!evidence) { for (const p of problems) console.log(`::error::${p}`); throw new Error(`${problems.length} removal-wiring problem(s); group must stay closed`); }
writeFileSync(out, JSON.stringify(evidence, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
console.log(`Removal checks verified on ${evidence.groupIds.join(', ')} at registry revision ${evidence.revision}. Opening still needs the other gates and your approval.`);
