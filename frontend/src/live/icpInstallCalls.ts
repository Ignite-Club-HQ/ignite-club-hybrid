/** Mainnet implementation of IcpInstallCalls: cycles-ledger creation with
 * subnet selection and management-canister chunked install, signed by the
 * operator identity. Never uses reinstall/upgrade modes. */
import { createHash } from 'node:crypto';
import { HttpAgent, Actor, type Identity } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import type { IcpInstallCalls } from './groupInstallAdapter';

export const CYCLES_LEDGER = 'um5iw-rqaaa-aaaaq-qaaba-cai';
const CHUNK = 1_000_000;

const ledgerIdl = ({ IDL: I }: { IDL: typeof IDL }) => {
  const settings = I.Record({ controllers: I.Opt(I.Vec(I.Principal)) });
  const selection = I.Variant({ Subnet: I.Record({ subnet: I.Principal }), Filter: I.Record({ subnet_type: I.Opt(I.Text) }) });
  const err = I.Variant({
    InsufficientFunds: I.Record({ balance: I.Nat }), TooOld: I.Null, CreatedInFuture: I.Record({ ledger_time: I.Nat64 }),
    TemporarilyUnavailable: I.Null, Duplicate: I.Record({ duplicate_of: I.Nat, canister_id: I.Opt(I.Principal) }),
    FailedToCreate: I.Record({ fee_block: I.Opt(I.Nat), refund_block: I.Opt(I.Nat), error: I.Text }),
    GenericError: I.Record({ message: I.Text, error_code: I.Nat }),
  });
  return I.Service({
    icrc1_balance_of: I.Func([I.Record({ owner: I.Principal, subaccount: I.Opt(I.Vec(I.Nat8)) })], [I.Nat], ['query']),
    create_canister: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64), amount: I.Nat,
      creation_args: I.Opt(I.Record({ settings: I.Opt(settings), subnet_selection: I.Opt(selection) })) })],
      [I.Variant({ Ok: I.Record({ block_id: I.Nat, canister_id: I.Principal }), Err: err })], []),
  });
};

const managementIdl = ({ IDL: I }: { IDL: typeof IDL }) => {
  const env = I.Vec(I.Record({ name: I.Text, value: I.Text }));
  return I.Service({
    canister_status: I.Func([I.Record({ canister_id: I.Principal })], [I.Record({
      status: I.Variant({ running: I.Null, stopping: I.Null, stopped: I.Null }),
      module_hash: I.Opt(I.Vec(I.Nat8)), settings: I.Record({ controllers: I.Vec(I.Principal) }) })], []),
    update_settings: I.Func([I.Record({ canister_id: I.Principal, settings: I.Record({ environment_variables: I.Opt(env) }) })], [], []),
    clear_chunk_store: I.Func([I.Record({ canister_id: I.Principal })], [], []),
    upload_chunk: I.Func([I.Record({ canister_id: I.Principal, chunk: I.Vec(I.Nat8) })], [I.Record({ hash: I.Vec(I.Nat8) })], []),
    install_chunked_code: I.Func([I.Record({
      mode: I.Variant({ install: I.Null }), target_canister: I.Principal, store_canister: I.Opt(I.Principal),
      chunk_hashes_list: I.Vec(I.Record({ hash: I.Vec(I.Nat8) })), wasm_module_hash: I.Vec(I.Nat8), arg: I.Vec(I.Nat8),
      sender_canister_version: I.Opt(I.Nat64) })], [], []),
  });
};
const cyclesIdl = ({ IDL: I }: { IDL: typeof IDL }) => I.Service({ cycles_balance: I.Func([], [I.Nat], ['query']) });

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());

export async function mainnetInstallCalls(host: string, identity: Identity): Promise<IcpInstallCalls> {
  const agent = await HttpAgent.create({ host, identity, shouldFetchRootKey: false });
  const owner = identity.getPrincipal();
  if (owner.isAnonymous()) throw new Error('Authenticated operator identity required');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped candid actor
  const ledger = Actor.createActor(ledgerIdl as never, { agent, canisterId: CYCLES_LEDGER }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped candid actor
  const mgmt = (id: string) => Actor.createActor(managementIdl as never, { agent, canisterId: Principal.fromText('aaaaa-aa'), effectiveCanisterId: Principal.fromText(id) }) as any;
  const pid = (id: string) => Principal.fromText(id);
  return {
    cyclesBalance: () => ledger.icrc1_balance_of({ owner, subaccount: [] }),
    async createCanister(a) {
      const r = await ledger.create_canister({ from_subaccount: [], created_at_time: [a.createdAtNs], amount: a.amount,
        creation_args: [{ settings: [{ controllers: [a.controllers.map(pid)] }], subnet_selection: [{ Subnet: { subnet: pid(a.subnetId) } }] }] });
      if ('Ok' in r) return { canisterId: r.Ok.canister_id.toText() };
      if ('Duplicate' in r.Err && r.Err.Duplicate.canister_id.length) return { duplicateOf: r.Err.Duplicate.canister_id[0].toText() };
      throw new Error(`Cycles ledger refused creation: ${JSON.stringify(r.Err, (_k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
    },
    subnetOf: async id => (await agent.getSubnetIdFromCanister(id)).toText(),
    async status(id) {
      const s = await mgmt(id).canister_status({ canister_id: pid(id) });
      return { controllers: s.settings.controllers.map((c: Principal) => c.toText()),
        moduleHash: s.module_hash.length ? hex(Uint8Array.from(s.module_hash[0])) : null, running: 'running' in s.status };
    },
    async setEnvironment(id, vars) { await mgmt(id).update_settings({ canister_id: pid(id), settings: { environment_variables: [vars] } }); },
    async installChunked(id, wasm, arg) {
      const m = mgmt(id);
      await m.clear_chunk_store({ canister_id: pid(id) });
      const hashes: { hash: Uint8Array }[] = [];
      for (let i = 0; i < wasm.length; i += CHUNK) {
        const chunk = wasm.subarray(i, i + CHUNK);
        const { hash } = await m.upload_chunk({ canister_id: pid(id), chunk });
        if (hex(Uint8Array.from(hash)) !== hex(sha(chunk))) throw new Error('Chunk hash mismatch');
        hashes.push({ hash: Uint8Array.from(hash) });
      }
      await m.install_chunked_code({ mode: { install: null }, target_canister: pid(id), store_canister: [], chunk_hashes_list: hashes,
        wasm_module_hash: sha(wasm), arg, sender_canister_version: [] });
    },
    sha256Hex: async b => hex(sha(b)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped candid actor
    cyclesOf: async id => (Actor.createActor(cyclesIdl as never, { agent, canisterId: id }) as any).cycles_balance(),
  };
}
