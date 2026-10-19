/** Read-only authenticated pre/post-upgrade gate. Never exports identity keys,
 * derives a private vetKey or modifies canister settings. */
import { createPrivateKey } from 'node:crypto';
import { readFileSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { Secp256k1KeyIdentity } from '@icp-sdk/core/identity/secp256k1';
import { attestDeployKey, verifyDeployKey } from './media-key-deploy-rules.mjs';
import { configuredMainnetPhotoKey } from './media-key-mainnet.mjs';
const [phase, mappingFile, receiptFile, deploymentId, environment] = process.argv.slice(2);
if (!['before', 'after'].includes(phase) || !mappingFile || !receiptFile || !deploymentId || !environment) throw new Error('Explicit deployment binding required');
const pem = process.env.DEPLOYER_PEM_FILE ? readFileSync(process.env.DEPLOYER_PEM_FILE, 'utf8') : process.env.DEPLOYER_PEM;
if (!pem) throw new Error('Governor credential unavailable: encrypted-photo key upgrade blocked');
const jwk = createPrivateKey(pem.replace(/\r/g, '').replace(/\\n/g, '\n')).export({ format: 'jwk' });
if (!jwk.d) throw new Error('Governor signing identity required');
const secret = new Uint8Array(Buffer.from(jwk.d, 'base64url'));
const identity = jwk.kty === 'OKP' ? Ed25519KeyIdentity.fromSecretKey(secret) : Secp256k1KeyIdentity.fromSecretKey(secret);
if (identity.getPrincipal().toText() !== process.env.GOVERNOR) throw new Error('Governor identity mismatch');
const mappings = JSON.parse(readFileSync(mappingFile, 'utf8')); const raw = mappings.pii_access_control;
const canisterId = typeof raw === 'string' ? raw : raw?.[environment] ?? raw?.id;
if (!canisterId) throw new Error('Existing PII canister mapping required');
const host = process.env.ICP_ATTEST_HOST ?? 'https://icp-api.io'; const u = new URL(host);
if (u.protocol !== 'https:' || u.origin !== host || u.username || u.password) throw new Error('Approved HTTPS deployment host required');
const agent = await HttpAgent.create({ host, identity }); const principal = Principal.fromText(canisterId);
const Pii = Actor.createActor(({ IDL }) => IDL.Service({ pii_vetkey_verification_key: IDL.Func([], [IDL.Vec(IDL.Nat8)], []) }), { agent, canisterId: principal });
const mgmt = Actor.createActor(({ IDL }) => IDL.Service({
  canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({ module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), settings: IDL.Record({ controllers: IDL.Vec(IDL.Principal) }) })], []),
}), { agent, canisterId: Principal.managementCanister(), effectiveCanisterId: principal });
const hex = b => Buffer.from(b).toString('hex');
const d = {
  async status() { const s = await mgmt.canister_status({ canister_id: principal }); return { moduleHash: s.module_hash[0] ? hex(s.module_hash[0]) : null, controllers: s.settings.controllers.map(p => p.toText()) }; },
  async originalKey() { return hex(await Pii.pii_vetkey_verification_key()); },
  async configuredKey() { return configuredMainnetPhotoKey(binding); },
  save(r) { const temp = `${receiptFile}.new`; const fd = openSync(temp, 'wx', 0o600); try { writeSync(fd, JSON.stringify(r)); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp, receiptFile); const dir = openSync(resolve(receiptFile, '..'), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); } },
};
const binding = { deploymentId, environment, host, canisterId, governor: identity.getPrincipal().toText(), keyName: 'key_1' };
if (phase === 'before') await attestDeployKey(binding, d); else await verifyDeployKey(binding, JSON.parse(readFileSync(receiptFile, 'utf8')), d);
console.log(`Original photo-key ${phase === 'before' ? 'attestation saved' : 'preservation verified'}; no private keys requested.`);