/** Read-only probe: do the shared router and account service already support
 * live routing approvals and generic group admission? Prints one JSON line.
 * The account probe asks for g1, which the service refuses before reading or
 * changing anything; an older build rejects the unknown method instead.
 * Usage: tsx scripts/probe-group-support.ts <operator.pem> */
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { IDENTITY, ROUTER, GOVERNOR } from '../../scripts/group2-admission-release-rules.mjs';

const [pem] = process.argv.slice(2);
if (!pem) throw new Error('Usage: probe-group-support <operator.pem>');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GOVERNOR) throw new Error('Existing governor required');
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const approval = IDL.Record({ target_alias: IDL.Text, configuration_revision: IDL.Nat64, approved_configuration_sha256: IDL.Text,
  removal_wiring_group_ids: IDL.Vec(IDL.Text), removal_checked_at_ms: IDL.Nat64, evidence_sha256: IDL.Text });
const router = Actor.createActor(() => IDL.Service({ read_routing_approval: IDL.Func([IDL.Text], [IDL.Variant({ Ok: IDL.Opt(approval), Err: IDL.Text })], []) }),
  { agent, canisterId: ROUTER }) as unknown as { read_routing_approval(a: string): Promise<unknown> };
const binding = IDL.Record({ registry: IDL.Principal, registry_revision: IDL.Nat64, target_alias: IDL.Text, deployment_id: IDL.Text,
  deployment_revision: IDL.Nat64, host: IDL.Text, network_kind: IDL.Text });
const account = Actor.createActor(() => IDL.Service({ authorize_group_admission: IDL.Func([IDL.Text, binding], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []) }),
  { agent, canisterId: IDENTITY }) as unknown as { authorize_group_admission(g: string, b: unknown): Promise<{ Ok: null } | { Err: string }> };
const missing = (e: unknown) => /has no (update|query) method|method not found|IC0536|IC0302/i.test(String((e as Error)?.message ?? e));
let routerOk = false, identityOk = false;
try { await router.read_routing_approval('mainnet'); routerOk = true; } catch (e) { if (!missing(e)) throw e; }
try {
  const r = await account.authorize_group_admission('g1', { registry: Principal.fromText(ROUTER), registry_revision: 0n, target_alias: 'mainnet',
    deployment_id: 'mainnet', deployment_revision: 0n, host: 'https://icp-api.io', network_kind: 'public_mainnet' });
  if ('Ok' in r || !/g2 or later/.test(r.Err)) throw new Error(`Unexpected account probe reply: ${JSON.stringify(r)}`);
  identityOk = true;
} catch (e) { if (!missing(e)) throw e; }
console.log(JSON.stringify({ router: routerOk, identity: identityOk }));
