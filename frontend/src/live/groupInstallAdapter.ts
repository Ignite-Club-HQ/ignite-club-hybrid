/** Closed new-group installer: creates and installs a group's per-group
 * services on the approved subnet, then stops before registration. The group is
 * never registered in the router, never opened and never receives clubs.
 *
 * Every external mutation is idempotent so a lost reply resumes exactly:
 * - create: the cycles ledger deduplicates on created_at_time, persisted in the
 *   intent before the call; a repeat returns the same canister (Duplicate).
 * - install: the module hash is read first; an identical module is never
 *   reinstalled, a foreign module refuses (never reinstall/overwrite).
 * Live group-1 canisters are refused everywhere. */
import { PER_GROUP_DOMAINS, type Provision, type ProvisionAdapter } from './groupProvisioner';
import type { GroupDomain } from './groupRouting';

export type CanisterStatus = { controllers: string[]; moduleHash: string | null; running: boolean };
export type CreateResult = { canisterId: string } | { duplicateOf: string };
/** Network calls, injected so the protocol is testable without mainnet. */
export type IcpInstallCalls = {
  cyclesBalance(): Promise<bigint>;
  createCanister(a: { createdAtNs: bigint; amount: bigint; subnetId: string; controllers: string[] }): Promise<CreateResult>;
  subnetOf(canisterId: string): Promise<string>;
  status(canisterId: string): Promise<CanisterStatus>;
  setEnvironment(canisterId: string, vars: { name: string; value: string }[]): Promise<void>;
  installChunked(canisterId: string, wasm: Uint8Array, arg: Uint8Array): Promise<void>;
  sha256Hex(bytes: Uint8Array): Promise<string>;
  /** Public query proving the installed service answers. */
  cyclesOf(canisterId: string): Promise<bigint>;
};
export type InstallArtifacts = {
  wasm(domain: GroupDomain): Uint8Array;
  initArg(domain: GroupDomain): Uint8Array;
  environment(domain: GroupDomain): { name: string; value: string }[];
};
export type InstallOptions = {
  operator: string; liveCanisters: Set<string>; cyclesPerCanister: bigint;
  nowNs: () => bigint;
};

/** Cycles ledger dedup window is 24h; older intents can no longer be reconciled by repeat. */
export const CREATE_DEDUP_WINDOW_NS = 23n * 3600n * 1_000_000_000n;
/** Covers creation plus ledger fees (0.1T per create on the cycles ledger). */
export const LEDGER_FEE = 100_000_000_000n;

export function requiredCycles(p: Provision, perCanister: bigint): bigint {
  const missing = PER_GROUP_DOMAINS.filter(d => !p.canisters[d]).length;
  return BigInt(missing) * (perCanister + LEDGER_FEE);
}

export function closedInstallAdapter(calls: IcpInstallCalls, art: InstallArtifacts, o: InstallOptions):
  Pick<ProvisionAdapter, 'createCanister' | 'createOperation' | 'install' | 'healthy'> {
  if (o.cyclesPerCanister < 500_000_000_000n) throw new Error('At least 0.5T cycles per canister required');
  const own = (id: string) => { if (o.liveCanisters.has(id)) throw new Error(`Refusing live canister ${id}`); };
  const hashes = new Map<GroupDomain, Promise<string>>();
  const expected = (d: GroupDomain) => {
    if (!hashes.has(d)) hashes.set(d, calls.sha256Hex(art.wasm(d)));
    return hashes.get(d)!;
  };
  return {
    createOperation: () => o.nowNs().toString(),
    async createCanister(p, domain) {
      const op = p.pending?.kind === 'create' && p.pending.domain === domain ? p.pending.operation : undefined;
      if (!op || !/^\d+$/.test(op)) throw new Error('Create intent must carry its ledger timestamp');
      const createdAtNs = BigInt(op);
      if (o.nowNs() - createdAtNs > CREATE_DEDUP_WINDOW_NS) throw new Error(`${domain} create intent older than the ledger dedup window; reconcile by hand`);
      const r = await calls.createCanister({ createdAtNs, amount: o.cyclesPerCanister, subnetId: p.subnetId, controllers: [o.operator] });
      const canisterId = 'canisterId' in r ? r.canisterId : r.duplicateOf;
      own(canisterId);
      if (Object.values(p.canisters).includes(canisterId)) throw new Error('Duplicate group canister');
      return { canisterId, subnetId: await calls.subnetOf(canisterId) };
    },
    async install(_p, domain, id) {
      own(id);
      const status = await calls.status(id);
      if (!status.controllers.includes(o.operator)) throw new Error(`Operator does not control ${domain}`);
      const want = await expected(domain);
      if (status.moduleHash === want) return; // acknowledged-lost install already landed
      if (status.moduleHash) throw new Error(`${domain} holds a different module; refusing to overwrite`);
      const env = art.environment(domain);
      if (env.length) await calls.setEnvironment(id, env);
      await calls.installChunked(id, art.wasm(domain), art.initArg(domain));
    },
    async healthy(_p, domain, id) {
      own(id);
      const status = await calls.status(id);
      if (!status.running || !status.controllers.includes(o.operator)) return false;
      if (status.moduleHash !== await expected(domain)) return false;
      return (await calls.cyclesOf(id)) > 0n;
    },
  };
}

/** Turns a failed-by-interruption record back into a resumable one and replays
 * its single unresolved create/install intent through the idempotent adapter.
 * Definite failures (wrong subnet, duplicates) carry no intent and stay failed. */
export async function resumeInterruptedInstall(start: Provision,
  a: Pick<ProvisionAdapter, 'createCanister' | 'install'>, save: (p: Provision) => Promise<void>): Promise<Provision> {
  let p = start;
  const pending = p.pending;
  if (!pending) return p;
  if (pending.kind !== 'create' && pending.kind !== 'install') return p; // configuration intents resolve elsewhere
  if (p.phase === 'failed') {
    const allCreated = PER_GROUP_DOMAINS.every(d => p.canisters[d]);
    p = { ...p, phase: pending.kind === 'install' || allCreated ? 'created' : 'approved', error: undefined };
  }
  const d = pending.domain;
  if (!d) throw new Error('Intent without domain');
  if (pending.kind === 'create') {
    if (p.canisters[d]) throw new Error(`${d} already recorded; intent inconsistent`);
    const c = await a.createCanister(p, d);
    p = { ...p, pending: undefined, canisters: { ...p.canisters, [d]: c.canisterId }, observedSubnets: { ...p.observedSubnets, [d]: c.subnetId } };
    await save(p);
    if (c.subnetId !== p.subnetId) { p = { ...p, phase: 'failed', error: `${d} landed on unapproved subnet ${c.subnetId}` }; await save(p); }
    return p;
  }
  const id = p.canisters[d];
  if (!id) throw new Error(`Install intent for uncreated ${d}`);
  await a.install(p, d, id);
  p = { ...p, pending: undefined, installedDomains: [...new Set([...(p.installedDomains ?? []), d])] };
  await save(p);
  return p;
}

/** Creates and installs the group's own photo store before configuration, with
 * the same idempotent create/install protocol. Configuring a new group against
 * the live shared store would replace that store's single club authority and
 * break existing clubs' uploads, quotas and staff deletes. */
export async function ensureDedicatedBlobStore(start: Provision,
  a: Pick<ProvisionAdapter, 'createCanister' | 'createOperation' | 'install' | 'healthy'>, save: (p: Provision) => Promise<void>): Promise<Provision> {
  const blob = 'media_blob_store' as unknown as GroupDomain;
  let p = start;
  let b = p.dedicatedBlobStore ?? {};
  if (!b.canisterId) {
    if (!b.createOperation) { b = { ...b, createOperation: a.createOperation!(p, blob) }; p = { ...p, dedicatedBlobStore: b }; await save(p); }
    const c = await a.createCanister({ ...p, pending: { kind: 'create', domain: blob, operation: b.createOperation } }, blob);
    b = { ...b, canisterId: c.canisterId, subnetId: c.subnetId }; p = { ...p, dedicatedBlobStore: b }; await save(p);
  }
  if (b.subnetId !== p.subnetId) throw new Error(`Group photo store landed on unapproved subnet ${b.subnetId}`);
  if (!b.installed) {
    await a.install(p, blob, b.canisterId!);
    b = { ...b, installed: true }; p = { ...p, dedicatedBlobStore: b }; await save(p);
  }
  if (!(await a.healthy(p, blob, b.canisterId!))) throw new Error('Group photo store failed health check');
  return p;
}
