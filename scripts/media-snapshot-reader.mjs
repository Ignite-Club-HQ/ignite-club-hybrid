/** Controller snapshot-byte reader. No deploy, start/stop, restore or key access.
 * Transport must authenticate management update replies and destination identity.
 * Raw module/heap/stable bytes are NOT decoded application ledger sections.
 */
import { hashRecoverySection } from './media-recovery-evidence.mjs';
import { createHash } from 'node:crypto';
const hex = x => Buffer.from(x).toString('hex');
const bytes = x => x instanceof Uint8Array || (Array.isArray(x) && x.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
const fail = () => { throw new Error('Invalid snapshot state evidence'); };
function validateRequest(r) {
  if (!r || ['canisterId', 'deploymentId', 'host', 'subnetId', 'registryRevision'].some(k => typeof r[k] !== 'string' || !r[k] || r[k].length > 512) ||
      typeof r.snapshotId !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(r.snapshotId)) fail();
}

/** Exact Candid from official ic.did; SDK injected to keep root dependency-free. */
export function snapshotReadTypes(IDL) {
  const range = IDL.Record({ offset: IDL.Nat64, size: IDL.Nat64 });
  const global = IDL.Variant({ i32: IDL.Int32, i64: IDL.Int64, f32: IDL.Float32, f64: IDL.Float64, v128: IDL.Nat });
  return {
    metadataInput: IDL.Record({ canister_id: IDL.Principal, snapshot_id: IDL.Vec(IDL.Nat8) }),
    metadataOutput: IDL.Record({ source: IDL.Variant({ taken_from_canister: IDL.Reserved, metadata_upload: IDL.Reserved }),
      taken_at_timestamp: IDL.Nat64, wasm_module_size: IDL.Nat64, globals: IDL.Vec(global), wasm_memory_size: IDL.Nat64,
      stable_memory_size: IDL.Nat64, wasm_chunk_store: IDL.Vec(IDL.Record({ hash: IDL.Vec(IDL.Nat8) })),
      canister_version: IDL.Nat64, certified_data: IDL.Vec(IDL.Nat8),
      global_timer: IDL.Opt(IDL.Variant({ inactive: IDL.Null, active: IDL.Nat64 })),
      on_low_wasm_memory_hook_status: IDL.Opt(IDL.Variant({ condition_not_satisfied: IDL.Null, ready: IDL.Null, executed: IDL.Null })) }),
    dataInput: IDL.Record({ canister_id: IDL.Principal, snapshot_id: IDL.Vec(IDL.Nat8), kind: IDL.Variant({
      wasm_module: range, wasm_memory: range, stable_memory: range, wasm_chunk: IDL.Record({ hash: IDL.Vec(IDL.Nat8) }) }) }),
    dataOutput: IDL.Record({ chunk: IDL.Vec(IDL.Nat8) }),
  };
}
function metadataState(m) {
  if (!m || !('taken_from_canister' in m.source) || !Array.isArray(m.globals) || !Array.isArray(m.wasm_chunk_store) ||
      m.wasm_chunk_store.length > 100000 || !bytes(m.certified_data)) fail();
  // Encode decoded scalar values with IEEE representation (-0 retained).
  // Candid decoding may normalize NaN payloads: this is not a bitwise NaN proof.
  const globals = m.globals.map(g => {
    const keys = Object.keys(g); if (keys.length !== 1) fail();
    const k = keys[0]; const v = g[k];
    if (k === 'f32' || k === 'f64') {
      const b = Buffer.alloc(k === 'f32' ? 4 : 8);
      if (k === 'f32') b.writeFloatLE(v); else b.writeDoubleLE(v);
      return [k, hex(b)];
    }
    if (!['i32', 'i64', 'v128'].includes(k)) fail();
    return [k, String(v)];
  });
  const chunkHashes = m.wasm_chunk_store.map(c => {
    if (!bytes(c.hash) || c.hash.length !== 32) fail(); return hex(c.hash);
  }).sort();
  if (new Set(chunkHashes).size !== chunkHashes.length) fail();
  const encode = x => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  // Exclude timestamp and canister_version: a new observation snapshot has new
  // bookkeeping after load. They are not application state equivalence claims.
  return encode([globals, hex(m.certified_data), m.global_timer, m.on_low_wasm_memory_hook_status, chunkHashes]);
}
/** Read an existing stopped participant snapshot through authenticated management
 * calls. Caller supplies independently verified status/placement checks before
 * and after EVERY read; no capability fallback to ordinary query or raw URL.
 */
export async function readSnapshotBytes(request, transport, { maxBytes = 8n * 1024n ** 3n } = {}) {
  validateRequest(request);
  if (typeof maxBytes !== 'bigint' || maxBytes < 0n) fail();
  const pinned = structuredClone(request);
  const check = () => transport.verifyStoppedPlacement(pinned);
  if (await check() !== true) fail();
  const m = await transport.readMetadata(pinned);
  const state = metadataState(m);
  let total = 0n;
  for (const field of ['wasm_module_size', 'wasm_memory_size', 'stable_memory_size']) {
    if (typeof m[field] !== 'bigint' || m[field] < 0n) fail(); total += m[field];
  }
  if (total > maxBytes) throw new Error('Snapshot exceeds operator read budget');
  const components = {};
  for (const kind of ['wasm_module', 'wasm_memory', 'stable_memory']) {
    const size = m[`${kind}_size`];
    async function* stream() {
      for (let offset = 0n; offset < size;) {
        const length = size - offset > 1_000_000n ? 1_000_000n : size - offset;
        if (await check() !== true) fail();
        const chunk = await transport.readData(pinned, { [kind]: { offset, size: length } });
        if (!bytes(chunk) || BigInt(chunk.length) !== length) fail();
        yield Uint8Array.from(chunk); offset += length;
      }
    }
    components[kind] = await hashRecoverySection(stream(), size);
  }
  // Uploaded Wasm chunks can be larger than the memory-read chunk ceiling.
  // Read each whole chunk per the official API, with an explicit remaining budget.
  const chunks = [];
  for (const c of m.wasm_chunk_store) {
    if (await check() !== true) fail();
    const chunk = await transport.readData(pinned, { wasm_chunk: { hash: c.hash } });
    if (!bytes(chunk) || chunk.length > 2_000_000) fail();
    total += BigInt(chunk.length); if (total > maxBytes) throw new Error('Snapshot exceeds operator read budget');
    const sha256 = createHash('sha256').update(Uint8Array.from(chunk)).digest('hex');
    if (sha256 !== hex(c.hash)) fail();
    chunks.push([sha256, String(chunk.length)]);
  }
  if (await check() !== true) fail();
  const reread = await transport.readMetadata(pinned);
  if (state !== metadataState(reread) || ['wasm_module_size', 'wasm_memory_size', 'stable_memory_size', 'taken_at_timestamp', 'canister_version'].some(k => m[k] !== reread[k])) fail();
  if (await check() !== true) fail();
  return { version: 1, request: pinned, components, metadataState: state, chunks: chunks.sort((a, b) => a[0].localeCompare(b[0])) };
}
/** Compare raw captured state only, not provenance or ledger semantics. Observation
 * snapshot id may differ; the independently bound request identity must not.
 */
export function equalSnapshotBytes(a, b) {
  if (a?.version !== 1 || b?.version !== 1) return false;
  const canonical = e => {
    validateRequest(e.request);
    if (!e.components || Object.keys(e.components).length !== 3 || typeof e.metadataState !== 'string' || !Array.isArray(e.chunks)) fail();
    const components = ['wasm_module', 'wasm_memory', 'stable_memory'].map(k => {
      const c = e.components[k];
      if (!c || typeof c.bytes !== 'string' || !/^(0|[1-9][0-9]*)$/.test(c.bytes) ||
          typeof c.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(c.sha256)) fail();
      return [k, c.bytes, c.sha256];
    });
    const { snapshotId, ...identity } = e.request;
    return JSON.stringify([Object.entries(identity).sort(([a], [b]) => a.localeCompare(b)), components, e.metadataState, e.chunks]);
  };
  try { return canonical(a) === canonical(b); } catch { return false; }
}
