/** Production operator transport: authenticated management-canister control
 * verification and signed configuration calls for new-group setup. The
 * operator identity (deploy/governor key) signs every call; governor control
 * is proven against the management canister, never trusted from local state. */
import { readFileSync } from 'node:fs';
import { HttpAgent, Actor, type ActorMethod } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { Secp256k1KeyIdentity } from '@icp-sdk/core/identity/secp256k1';
import { createPrivateKey } from 'node:crypto';
import type { ConfigurationTransport } from './groupProvisionConfiguration';

export type OperatorIdentity = Ed25519KeyIdentity | Secp256k1KeyIdentity;

/** Load the operator identity from a PEM file: secp256k1 (icp-cli's default,
 * "EC PRIVATE KEY") or Ed25519 (raw or SEC1 v2). */
export function loadOperatorIdentity(pemPath: string): OperatorIdentity {
  const pem = readFileSync(pemPath, 'utf8');
  if (/BEGIN EC PRIVATE KEY/.test(pem)) return Secp256k1KeyIdentity.fromPem(pem);
  // PKCS#8 "BEGIN PRIVATE KEY" may hold either curve (icp-cli exports secp256k1 this way);
  // decode the algorithm instead of assuming Ed25519, which silently yields a different principal.
  let jwk: { kty?: string; crv?: string; d?: string } | null = null;
  try { jwk = createPrivateKey(pem).export({ format: 'jwk' }) as typeof jwk; } catch { jwk = null; }
  if (jwk?.d) {
    const secret = new Uint8Array(Buffer.from(jwk.d, 'base64url'));
    if (jwk.kty === 'EC' && jwk.crv === 'secp256k1') return Secp256k1KeyIdentity.fromSecretKey(secret);
    if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') return Ed25519KeyIdentity.fromSecretKey(secret);
    throw new Error('Unsupported operator key algorithm');
  }
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  // Raw 32-byte seed; 64-byte secretKey (seed||public) keeps the seed half;
  // SEC1 v2 ("MC4CAQAwBQYDK2VwBCIEIC...") carries the seed as the final 32 bytes.
  const seed = der.length === 32 ? der : der.length === 64 ? der.subarray(0, 32) : der.subarray(der.length - 32);
  if (seed.length !== 32) throw new Error('Invalid operator key material');
  return Ed25519KeyIdentity.fromSecretKey(new Uint8Array(seed));
}

const managementIdl = ({ IDL: idl }: { IDL: typeof IDL }) => idl.Service({
  canister_status: idl.Func(
    [idl.Record({ canister_id: idl.Principal })],
    [idl.Record({ settings: idl.Record({ controllers: idl.Vec(idl.Principal) }) })],
    [],
  ),
});

export type OperatorTransportOptions = {
  host: string;
  identity: OperatorIdentity;
  /** idlFactory per canister id, for the domains the transport may configure. */
  idls: Map<string, (ctx: { IDL: typeof IDL }) => unknown>;
  /** Fetch root key for local replicas; never on mainnet. */
  fetchRootKey?: boolean;
  /** Rehearsal-only controller proof: PocketIC's management canister refuses
   * ingress canister_status, so local replicas verify controllers through the
   * server API instead. Never set on mainnet. */
  statusOverride?: (canisterId: string, governor: string) => Promise<void>;
};

export async function createOperatorTransport(options: OperatorTransportOptions): Promise<ConfigurationTransport> {
  if (options.identity.getPrincipal().isAnonymous()) throw new Error('Authenticated operator identity required');
  const agent = await HttpAgent.create({ host: options.host, identity: options.identity, shouldFetchRootKey: Boolean(options.fetchRootKey) });
  const operator = options.identity.getPrincipal().toText();
  // Management calls go to aaaaa-aa with the target as the effective id
  // (mainnet routes the update to the target's subnet).
  const management = (canisterId: string) => Actor.createActor(managementIdl, { agent, canisterId: Principal.fromText('aaaaa-aa'), effectiveCanisterId: Principal.fromText(canisterId) }) as unknown as {
    canister_status: (arg: { canister_id: Principal }) => Promise<{ settings: { controllers: Principal[] } }>;
  };
  return {
    async verifyGovernor(canisterId: string, governor: string) {
      if (governor !== operator) throw new Error('Transport identity does not match the required governor');
      if (options.statusOverride) return await options.statusOverride(canisterId, governor);
      const status = await management(canisterId).canister_status({ canister_id: Principal.fromText(canisterId) });
      if (!status.settings.controllers.some(c => c.toText() === governor)) {
        throw new Error(`Operator does not control ${canisterId}`);
      }
    },
    async call(canisterId: string, method: string, args: unknown[]) {
      const idlFactory = options.idls.get(canisterId);
      if (!idlFactory) throw new Error(`No contract bound for ${canisterId}`);
      const actor = Actor.createActor(idlFactory as never, { agent, canisterId }) as unknown as Record<string, ActorMethod>;
      const fn = actor[method];
      if (typeof fn !== 'function') throw new Error(`Contract ${canisterId} has no method ${method}`);
      return await fn(...args) as { Ok: unknown } | { Err: string };
    },
  };
}
