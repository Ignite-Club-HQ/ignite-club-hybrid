/** Dedicated paid mainnet rehearsal. No routing, club, quota or PII configuration. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { mainnetInstallCalls } from '../src/live/icpInstallCalls';
import { DEPLOYED_MAINNET_CANISTER_IDS as LIVE } from '../src/live/generated/deployedCanisterIds';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { approveTest, assertResume, isUnpaidAttempt, isResumableInstall, isResumableFill, isTransientReject, assertTarget, assertFuel, assertAffordable, isOutOfCycles, environmentFor, isSmokeScenario, LEDGER_FEE } from './media-stage-two-policy.mjs';
import { createJournalApi } from './media-stage-two-github.mjs';
import { DEPLOY_PRINCIPAL } from '../../scripts/media-card-funding-policy.mjs';
import { recoveryBinding, drainTestUploads, reconcileFill, settledBatch } from './media-stage-two-recovery.mjs';

console.log('Media store test starting');
process.on('exit', code => console.log(`Media store test exiting with code ${code}`));
process.on('uncaughtException', e => { console.log(`Uncaught failure: ${e instanceof Error ? e.stack ?? e.message : String(e)}`); process.exit(1); });
process.on('unhandledRejection', e => { console.log(`Unhandled failure: ${e instanceof Error ? e.stack ?? e.message : String(e)}`); process.exit(1); });
const root = resolve(import.meta.dirname, '../..');
const identity = loadOperatorIdentity(process.env.OPERATOR_PEM_PATH ?? '');
if (identity.getPrincipal().toText() !== DEPLOY_PRINCIPAL) throw new Error(`Loaded key resolves to ${identity.getPrincipal().toText()}, not the funded deploy identity ${DEPLOY_PRINCIPAL}; nothing was spent`);
const source = readFileSync(process.env.TEST_WASM_PATH ?? '');
const wasm = source[0] === 31 && source[1] === 139 ? gunzipSync(source) : source;
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
let binding = approveTest({ runId: process.env.TEST_RUN_ID, scenario: process.env.TEST_SCENARIO,
  budgetT: process.env.TEST_BUDGET_T, confirm: process.env.TEST_CONFIRM,
  governor: identity.getPrincipal().toText(), subnetId: JSON.parse(readFileSync(join(root, 'deploy/groups/tested-limits.json'), 'utf8')).subnetId,
  wasmSha256: hash(wasm) });
const candidateBinding = binding;
let expectedModule = binding.wasmSha256;
const repo = process.env.GITHUB_REPOSITORY;
if (!repo || !process.env.GH_TOKEN) throw new Error('GitHub durable journal access required before any paid call');
const branch = 'ignite-media-test-receipts';
const file = `deploy/media-tests/${binding.runId}.json`;
const out = process.env.TEST_REPORT_DIR ?? '/tmp/media-stage-two';
mkdirSync(out, { recursive: true });
const json = (x: unknown) => JSON.stringify(x, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2);
const api = createJournalApi(repo, json);
function readJournal(path: string) {
  const entry = api(`contents/${path}?ref=${branch}`);
  // Contents responses omit inline content above 1 MiB; tiny-file evidence exceeds that.
  const blob = api(`git/blobs/${entry.sha}`);
  if (blob.encoding !== 'base64') throw new Error('Unexpected journal blob encoding');
  return { sha: entry.sha, text: Buffer.from(blob.content, 'base64').toString() };
}
// A dedicated branch keeps frequent evidence updates out of application source history.
const refs = api('git/matching-refs/heads/ignite-media-test-receipts');
if (!refs.some((r: any) => r.ref === `refs/heads/${branch}`)) {
  const base = api(`git/ref/heads/${api('').default_branch}`);
  api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: base.object.sha });
}
const entries = api(`git/trees/${branch}?recursive=1`);
if (entries.truncated) throw new Error('Incomplete journal inventory');
let sha: string | undefined;
let state: any = { binding, phase: 'approved', pending: null, receipts: [], objects: {} };
if (entries.tree.some((e: any) => e.path === file)) {
  const r = readJournal(file); sha = r.sha;
  const saved = JSON.parse(r.text);
  const original = recoveryBinding(saved, candidateBinding);
  if (original && (isResumableFill(saved, original) || saved.phase === 'complete')) {
    binding = original;
    expectedModule = saved.recoveryUpdate?.status === 'complete' ? candidateBinding.wasmSha256 : original.wasmSha256;
  }
  if (isUnpaidAttempt(saved)) {
    // Earlier attempt stopped before creation (e.g. unfunded deploy account): nothing was paid, restart cleanly.
    console.log(`Earlier attempt of ${binding.runId} never created a canister (${saved.error ?? 'no error recorded'}); restarting.`);
    state.previousUnpaidAttempts = [...(saved.previousUnpaidAttempts ?? []), { error: saved.error ?? null, binding: saved.binding }];
  } else if (isResumableInstall(saved, binding)) {
    // Created and verified, but install stopped before code was written; the install step re-proves
    // the exact target and only installs onto an empty module (or skips when the exact build is present).
    state = saved; state.pending = null; state.resumedInstall = new Date().toISOString();
    console.log(`Resuming ${binding.runId} at install on existing test store ${state.canisterId}`);
  } else if (isResumableFill(saved, binding)) {
    // Fill was cut off mid-way; the fill step reconciles every test path against the store before continuing.
    state = saved; state.pending = null; state.resumedFill = [...(saved.resumedFill ?? []), { at: new Date().toISOString(), error: saved.error ?? null }];
    delete state.error; console.log(`Resuming ${binding.runId} at fill on existing test store ${state.canisterId}`);
  } else {
    state = saved; assertResume(state, binding);
    if (state.phase !== 'complete') throw new Error('Interrupted test requires operator reconciliation; use a new id only after accounting for the old target');
    console.log(`Already complete: ${state.canisterId}`); process.exit(0);
  }
}
async function save() {
  const text = json(state) + '\n';
  writeFileSync(join(out, 'report.json'), text);
  const r = api(`contents/${file}`, 'PUT', { message: `Storage test ${binding.runId}: ${state.phase}`, branch,
    content: Buffer.from(text).toString('base64'), ...(sha ? { sha } : {}) });
  sha = r.content.sha;
  const check = readJournal(file);
  if (check.text !== text) throw new Error('Durable checkpoint read-back mismatch');
}
const protectedIds = new Set<string>(Object.values(LIVE));
// Include every checked-in group and earlier test target, not just generated group-1 IDs.
function collect(x: any) {
  if (typeof x === 'string' && /^[a-z0-9-]+-cai$/.test(x)) protectedIds.add(x);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) collect(v);
}
function scan(dir: string) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.')) scan(join(dir, e.name));
    else if (e.isFile() && e.name.endsWith('.json')) collect(JSON.parse(readFileSync(join(dir, e.name), 'utf8')));
  }
}
scan(join(root, 'deploy/groups')); scan(join(root, 'deploy/mainnet/.icp/data/mappings'));
for (const e of entries.tree.filter((e: any) => e.path !== file && /^deploy\/media-tests\/[^/]+\.json$/.test(e.path))) {
  const r = readJournal(e.path); collect(JSON.parse(r.text));
}
const agent = await HttpAgent.create({ identity, host: binding.host, shouldFetchRootKey: false });
const calls = await mainnetInstallCalls(binding.host, identity);
const pid = (s: string) => Principal.fromText(s);
const managementIdl = ({ IDL: I }: { IDL: typeof IDL }) => I.Service({
  canister_status: I.Func([I.Record({ canister_id: I.Principal })], [I.Record({ cycles: I.Nat, version: I.Nat64, idle_cycles_burned_per_day: I.Nat, reserved_cycles: I.Nat, memory_size: I.Nat,
    module_hash: I.Opt(I.Vec(I.Nat8)), settings: I.Record({ freezing_threshold: I.Nat, controllers: I.Vec(I.Principal), environment_variables: I.Vec(I.Record({ name: I.Text, value: I.Text })) }) })], []),
  install_code: I.Func([I.Record({ mode: I.Variant({ upgrade: I.Opt(I.Record({ skip_pre_upgrade: I.Opt(I.Bool), wasm_memory_persistence: I.Opt(I.Variant({ keep: I.Null, replace: I.Null })) })) }),
    canister_id: I.Principal, wasm_module: I.Vec(I.Nat8), arg: I.Vec(I.Nat8), sender_canister_version: I.Opt(I.Nat64) })], [], []),
});
let m: any, a: any;
async function proof(module: string | null = expectedModule) {
  const s = await calls.status(state.canisterId);
  assertTarget(binding, state.canisterId, s, await calls.subnetOf(state.canisterId), protectedIds, module);
  const status = await m.canister_status({ canister_id: pid(state.canisterId) });
  assert.deepEqual(status.settings.controllers.map((p: Principal) => p.toText()), [binding.governor]);
  assert.deepEqual([...status.settings.environment_variables].sort((x: any, y: any) => x.name.localeCompare(y.name)),
    [...environmentFor(binding)].sort((x, y) => x.name.localeCompare(y.name)));
  return status;
}
// Cycles the network refuses to spend: idle burn per second × freezing threshold (seconds).
function freezeReserve(s: any): bigint { return BigInt(s.idle_cycles_burned_per_day) * BigInt(s.settings.freezing_threshold) / 86_400n; }
let lastFuelLog = 0;
async function fuel(nextBytes = 0) {
  const s = await proof(); const reserve = freezeReserve(s);
  if (Date.now() - lastFuelLog > 60_000) { lastFuelLog = Date.now();
    console.log(`Fuel ${s.cycles} cycles; frozen reserve ${reserve}; reserved ${s.reserved_cycles}; memory ${s.memory_size} bytes`); }
  state.lastFuel = { cycles: s.cycles.toString(), freezeReserve: reserve.toString(), reserved: s.reserved_cycles.toString(), memory: s.memory_size.toString() };
  assertFuel(binding, s.cycles, BigInt(state.initialCycles), nextBytes, reserve); return s;
}
async function affordable(remainingBytes: number, remainingObjects = 0) {
  const s = await proof(); assertAffordable(binding, s.cycles, BigInt(state.initialCycles), remainingBytes, freezeReserve(s), remainingObjects);
  console.log(`Fuel ${s.cycles} covers the remaining ~${(remainingBytes / 1024 ** 3).toFixed(2)} GiB of uploads`);
}
async function phase(name: string, work: () => Promise<unknown>) {
  const prior = state.receipts.find((r: any) => r.phase === name);
  if (prior) { console.log(`Phase ${name} already recorded; not repeated`); return prior.result; }
  console.log(`Phase ${name}: starting`);
  state.phase = name; state.pending = { kind: name, time: new Date().toISOString() }; await save();
  const result = await work(); state.receipts.push({ phase: name, result, time: new Date().toISOString() });
  state.pending = null; await save(); return result;
}
const ok = (r: any) => { if (!('Ok' in r)) throw new Error(`Store refusal: ${json(r)}`); return r.Ok; };
const MiB = 1024 ** 2, CHUNK = 1_000_000;
const uploads: number[] = [], reads: number[] = []; const refused: Record<string, number> = {};
function total() { return Object.values(state.objects).reduce((s: number, f: any) => s + f.size, 0); }
async function retry<T>(label: string, call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await call(); } catch (e) {
      if (isOutOfCycles(e)) throw new Error(`Test store ran low on fuel during ${label}; stopped (unfinished uploads are cleared on the next resume)`);
      if (!isTransientReject(e) || attempt >= 8) throw e;
      state.transientRejects = (state.transientRejects ?? 0) + 1;
      console.log(`Store busy on ${label} (attempt ${attempt}); retrying`); await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}
async function upload(path: string, size: number) {
  const bytes = Buffer.alloc(size, size % 251), started = performance.now();
  const r = await retry('begin_upload', () => a.begin_upload(path, 'application/octet-stream', BigInt(size), Math.ceil(size / CHUNK)));
  if ('Err' in r) { refused[r.Err] = (refused[r.Err] ?? 0) + 1; if (r.Err !== 'StoreFull') throw new Error(`Unexpected refusal: ${r.Err}`); return false; }
  for (let i = 0; i < Math.ceil(size / CHUNK); i++) ok(await retry('put_chunk', () => a.put_chunk(r.Ok, i, bytes.subarray(i * CHUNK, (i + 1) * CHUNK))));
  let final; try { final = await a.finalize_upload(r.Ok); } catch (e) { if (isOutOfCycles(e)) throw new Error('Test store ran low on fuel during finalize_upload; stopped (unfinished uploads are cleared on the next resume)'); throw e; }
  if ('Err' in final) { ok(await a.abort_upload(r.Ok)); refused[final.Err] = (refused[final.Err] ?? 0) + 1; if (final.Err !== 'StoreFull') throw new Error(`Unexpected refusal: ${final.Err}`); return false; }
  assert.equal(final.Ok.content_hash, hash(bytes)); assert.equal(final.Ok.content_length, BigInt(size));
  state.objects[path] = { size, hash: final.Ok.content_hash }; uploads.push(performance.now() - started); return true;
}
async function verify(path: string) {
  const f = state.objects[path]; assert.ok(f); const started = performance.now();
  const r = await a.http_request({ url: `/${path}`, method: 'GET', headers: [], body: [] }); assert.equal(r.status_code, 200);
  const digest = createHash('sha256'); digest.update(Buffer.from(r.body)); let length = r.body.length;
  let token = r.streaming_strategy[0]?.Callback.token, pages = 0;
  while (token) { assert.ok(++pages <= Math.ceil(f.size / CHUNK) + 1); const p = await a.http_request_streaming_callback(token);
    assert.ok(p.body.length <= CHUNK); digest.update(Buffer.from(p.body)); length += p.body.length; token = p.token[0]; }
  assert.equal(length, f.size); assert.equal(digest.digest('hex'), f.hash); reads.push(performance.now() - started);
}
const funding = BigInt(binding.budgetCycles) - LEDGER_FEE;
const available = await calls.cyclesBalance();
// Checked before any journal write so an unfunded attempt leaves no record blocking the same id.
if (!state.canisterId && available < BigInt(binding.budgetCycles)) throw new Error(`Deploy identity holds ${available} cycles; needs ${binding.budgetCycles} (approved funding plus ledger fee). Fund it, then re-run with the same id.`);
console.log(state.canisterId ? `Test store ${state.canisterId} already funded at creation; deploy balance ${available} not needed.` : `Deploy identity balance ${available} cycles covers approved ${binding.budgetCycles}.`);
try {
  await save();
  await phase('create', async () => {
    state.createdAtNs = (BigInt(Date.now()) * 1_000_000n).toString(); await save();
    const r = await calls.createCanister({ createdAtNs: BigInt(state.createdAtNs), amount: funding, subnetId: binding.subnetId, controllers: [binding.governor] });
    state.canisterId = 'canisterId' in r ? r.canisterId : r.duplicateOf;
    assertTarget(binding, state.canisterId, await calls.status(state.canisterId), await calls.subnetOf(state.canisterId), protectedIds, null);
    return { canisterId: state.canisterId, fundedCycles: funding };
  });
  m = Actor.createActor(managementIdl, { agent, canisterId: 'aaaaa-aa', effectiveCanisterId: pid(state.canisterId) });
  await phase('install', async () => {
    const before = await calls.status(state.canisterId);
    assertTarget(binding, state.canisterId, before, await calls.subnetOf(state.canisterId), protectedIds, before.moduleHash === null ? null : binding.wasmSha256);
    await calls.setEnvironment(state.canisterId, environmentFor(binding));
    const current = (await calls.status(state.canisterId)).moduleHash;
    if (current === null) { await proof(null); await calls.installChunked(state.canisterId, wasm, IDL.encode([], [])); }
    else if (current !== binding.wasmSha256) throw new Error('Unexpected module on test store; never reinstall');
    await proof();
    return { wasmSha256: binding.wasmSha256, environment: environmentFor(binding) };
  });
  a = Actor.createActor(idlFactory, { agent, canisterId: state.canisterId });
  if (!state.initialCycles) state.initialCycles = (await proof()).cycles.toString();
  if (state.resumedFill?.length && candidateBinding.wasmSha256 !== binding.wasmSha256) {
    assert.ok(recoveryBinding(state, candidateBinding), 'Only the approved interrupted target may receive recovery code');
    const current = (await calls.status(state.canisterId)).moduleHash;
    if (current === candidateBinding.wasmSha256) {
      assert.equal(state.recoveryUpdate?.to, candidateBinding.wasmSha256, 'New module requires a saved upgrade intent');
      await proof(candidateBinding.wasmSha256);
    } else {
      assert.equal(current, binding.wasmSha256, 'Unexpected recovery target module');
      if (state.recoveryUpdate?.status === 'pending') throw new Error('Unresolved recovery upgrade; operator reconciliation required before retry');
      await fuel();
      state.recoveryUpdate = { from: binding.wasmSha256, to: candidateBinding.wasmSha256, status: 'pending' }; await save();
      if (wasm.length > 1_900_000) throw new Error('Recovery module exceeds bounded direct upgrade size');
      await m.install_code({ mode: { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] },
        canister_id: pid(state.canisterId), wasm_module: wasm, arg: IDL.encode([], []), sender_canister_version: [] });
      await proof(candidateBinding.wasmSha256);
    }
    expectedModule = candidateBinding.wasmSha256;
    state.recoveryUpdate = { ...state.recoveryUpdate, status: 'complete' }; await save();
    console.log(`Recovery update verified on existing isolated store ${state.canisterId}`);
  }
  await phase('configure-empty', async () => {
    assert.equal((await a.health()).blob_count, 0n); assert.equal((await a.get_usage()).total_bytes, 0n);
    ok(await a.enable_stable_media_storage()); ok(await a.set_capacity_limit(BigInt(binding.capacityBytes)));
    assert.equal((await a.get_usage()).capacity_limit_bytes, BigInt(binding.capacityBytes));
    assert.equal((await a.stable_storage_status()).enabled, true); return { memory: await a.memory_stats() };
  });
  const prefix = `users/network-test/${binding.runId}/`;
  await phase('smoke', async () => {
    await fuel(); assert.equal(await upload(prefix + 'smoke', 2 * MiB), true); await verify(prefix + 'smoke');
    const otherAgent = await HttpAgent.create({ host: binding.host, shouldFetchRootKey: false });
    const other: any = Actor.createActor(idlFactory, { agent: otherAgent, canisterId: state.canisterId });
    let denied = false; try { denied = 'Err' in await other.delete_blob(prefix + 'smoke'); } catch { denied = true; }
    assert.ok(denied); await verify(prefix + 'smoke'); ok(await a.delete_blob(prefix + 'smoke')); delete state.objects[prefix + 'smoke'];
    const aborted = ok(await a.begin_upload(prefix + 'abort', 'application/octet-stream', BigInt(2 * MiB), 3));
    ok(await a.put_chunk(aborted, 0, Buffer.alloc(CHUNK))); ok(await a.abort_upload(aborted));
    assert.equal((await a.get_usage()).total_bytes, 0n); return { hashReadback: true, unauthorizedDeleteDenied: true, abortVerified: true };
  });
  if (!isSmokeScenario(binding.scenario)) {
    await phase('fill', async () => {
      const sizes = binding.scenario === 'tiny' ? [1024] : [MiB, 2 * MiB, 400 * 1024, 4 * MiB, 8 * MiB, 2 * MiB];
      const max = binding.scenario === 'tiny' ? 10000 : 4000; const start = performance.now(); let sawRefusal = false;
      if (state.resumedFill?.length) {
        await fuel();
        const cleared = await drainTestUploads({ actor: a, prefix, sizes, max,
          saveIntent: async (row: unknown) => { state.pendingRecoveryAbort = row; await save(); },
          saveReceipt: async (row: unknown) => { (state.recoveredAborts ??= []).push(row); state.pendingRecoveryAbort = null; await save(); } });
        state.pendingRecoveryAbort = null;
        state.objects = await reconcileFill({ actor: a, prefix, sizes, max, digest: (size: number) => hash(Buffer.alloc(size, size % 251)) });
        console.log(`Cleared ${cleared} unfinished test uploads; reconciled ${Object.keys(state.objects).length} stored objects (${total()} bytes)`); await save();
      }
      // Fill to capacity, then churn re-uploads half the payload twice (≈ one more full payload).
      // Tiny files exhaust 64 KiB slots long before byte capacity, so price by the record bound instead.
      const fillBytes = binding.scenario === 'tiny' ? max * 1024 : binding.capacityBytes;
      const stored = Object.keys(state.objects).length;
      await affordable(Math.max(0, fillBytes - total()) + fillBytes, binding.scenario === 'tiny' ? Math.max(0, max - stored) + max / 2 : 0);
      for (let i = 0; i < max; i += 4) {
        const missing = Array.from({ length: Math.min(4, max - i) }, (_, j) => i + j).filter(index => !state.objects[prefix + index]);
        if (!missing.length) continue;
        await fuel(missing.reduce((s, index) => s + sizes[index % sizes.length], 0)); const results = await settledBatch(missing.map(index => upload(prefix + index, sizes[index % sizes.length])));
        if (i % 200 === 0) { await save(); console.log(`Fill ${Object.keys(state.objects).length} objects, ${total()} bytes`); }
        if (results.every(x => !x)) { sawRefusal = true; break; }
      }
      assert.ok(sawRefusal, 'Must observe capacity refusal, not just stop at a record bound');
      assert.equal((await a.get_usage()).total_bytes, BigInt(total()));
      state.fillPayload = total(); state.fillPhysical = (await a.stable_storage_status()).allocated_bytes.toString();
      return { objects: Object.keys(state.objects).length, payloadBytes: total(), physicalHighWaterBytes: state.fillPhysical,
        fillMs: performance.now() - start, refusalReasons: refused, memory: await a.memory_stats(), cycles: (await fuel()).cycles };
    });
    await phase('churn', async () => {
      const chosen = Object.entries(state.objects).filter((_, i) => i % 2 === 0);
      await affordable(2 * chosen.reduce((s, [, f]: any) => s + f.size, 0));
      for (let round = 0; round < 2; round++) for (let i = 0; i < chosen.length; i += 4) {
        const batch = chosen.slice(i, i + 4); await fuel(batch.reduce((s, [, f]: any) => s + f.size, 0));
        await settledBatch(batch.map(async ([path]) => { ok(await a.delete_blob(path)); delete state.objects[path]; }));
        await settledBatch(batch.map(async ([path, f]: any) => assert.equal(await upload(path, f.size), true)));
        if (i % 200 === 0) { await save(); console.log(`Churn ${round + 1}: ${i}/${chosen.length}`); }
      }
      assert.equal(total(), state.fillPayload); assert.equal((await a.get_usage()).total_bytes, BigInt(total()));
      assert.equal((await a.stable_storage_status()).allocated_bytes.toString(), state.fillPhysical); return { rounds: 2, exactTotals: true };
    });
  }
  await phase('upgrade-mid-upload', async () => {
    await fuel();
    // Tiny test must free enough 64 KiB slots for a genuinely multi-chunk file.
    const keys = Object.keys(state.objects); const keepSamples = keys.slice(-6);
    let removed = 0;
    let deleted = 0;
    for (const path of keys.slice(0, -6)) {
      if (removed >= 4 * MiB) break;
      if (deleted++ % 4 === 0) await fuel();
      const f = state.objects[path]; ok(await a.delete_blob(path));
      removed += Math.max(65536, 2 ** Math.ceil(Math.log2(f.size))); delete state.objects[path];
    }
    const bytes = Buffer.alloc(2 * MiB, 7); const path = prefix + 'interrupted';
    const id = ok(await a.begin_upload(path, 'application/octet-stream', BigInt(bytes.length), 3)); ok(await a.put_chunk(id, 0, bytes.subarray(0, CHUNK)));
    state.pendingUpload = { id, path, size: bytes.length, hash: hash(bytes) }; await save();
    const before = await fuel();
    if (wasm.length > 1_900_000) throw new Error('Module too large for bounded direct upgrade; chunked upgrade implementation required');
    await m.install_code({ mode: { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] }, canister_id: pid(state.canisterId),
      wasm_module: wasm, arg: IDL.encode([], []), sender_canister_version: [] });
    const after = await proof(); assert.ok(after.version > before.version);
    assert.equal((await a.get_usage()).capacity_limit_bytes, BigInt(binding.capacityBytes));
    for (let i = 1; i < 3; i++) ok(await a.put_chunk(id, i, bytes.subarray(i * CHUNK, (i + 1) * CHUNK)));
    const r = ok(await a.finalize_upload(id)); assert.equal(r.content_hash, hash(bytes)); state.objects[path] = { size: bytes.length, hash: r.content_hash };
    await verify(path); for (const sample of keepSamples) await verify(sample);
    assert.equal((await a.get_usage()).total_bytes, BigInt(total())); return { recovered: true, previousVersion: before.version, upgradedVersion: after.version };
  });
  const percentile = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))] ?? null;
  state.summary = { payloadBytes: total(), objects: Object.keys(state.objects).length, physical: await a.stable_storage_status(),
    realCyclesConsumedSinceInstall: BigInt(state.initialCycles) - (await fuel()).cycles, uploadSamples: uploads.length,
    uploadMedianMs: percentile(uploads, .5), uploadP95Ms: percentile(uploads, .95), verifiedReads: reads.length, readP95Ms: percentile(reads, .95),
    configuredCapacityBytes: binding.capacityBytes,
    productionCapacityProven: false, limitations: ['Synthetic owner paths only; no club entitlement, encryption or UI acceptance.', 'Funding ceiling includes retained idle fuel; storage upkeep continues until operator cleanup.', 'A configured ceiling and small smoke test do not prove full-volume usable capacity.'] };
  state.phase = 'complete'; state.pending = null; await save(); console.log(`PASS isolated ${binding.scenario}; report on ${branch}/${file}`);
} catch (error) {
  state.error = error instanceof Error ? error.message : 'Test failed';
  try { await save(); } catch { writeFileSync(join(out, 'report.json'), json(state)); }
  throw error;
}