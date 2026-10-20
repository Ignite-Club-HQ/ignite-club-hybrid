// Existing actor only, isolated PocketIC, synthetic ciphertext; never mainnet.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
const wasm = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/media_blob_store/.mops/.build/media_blob_store.wasm');
const governor = Principal.fromUint8Array(new Uint8Array([1, 1]));
const ok = r => { assert.ok('Ok' in r, JSON.stringify(r, (_, v) => typeof v === 'bigint' ? String(v) : v)); return r.Ok; };
const hash = b => createHash('sha256').update(b).digest('hex');
const pct = (v, p) => { const s = [...v].sort((a,b) => a-b); return s[Math.min(s.length-1, Math.floor(s.length*p))] ?? null; };
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/tmp/pocket-ic' });
const results = [];
try {
 for (const scenario of [
  { name: 'legacy-mixed', stable: false, ceiling: 32*1048576, sizes: [200000,400000,200000,1100000,2100000,8000000], max: 160 },
  { name: 'stable-mixed', stable: true, ceiling: 256*1048576, sizes: [200000,400000,200000,1100000,2100000,8000000], max: 512 },
  { name: 'stable-small', stable: true, ceiling: 16*1048576, sizes: [1024], max: 300 },
 ]) {
  const pic = await PocketIc.create(server.getUrl());
  try {
   const fixture = await pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables: [{ name:'GOVERNOR_PRINCIPAL', value:governor.toText() },{ name:'IGNITE_MEDIA_SLOT_LOCAL_REHEARSAL',value:'1' }] });
   const a = fixture.actor; a.setPrincipal(governor);
   if (scenario.stable) ok(await a.enable_stable_media_storage());
   ok(await a.set_capacity_limit(BigInt(scenario.ceiling)));
   const baseline = await a.memory_stats(), startCycles = await pic.getCyclesBalance(fixture.canisterId);
   const live = new Map(), uploads = [], reads = []; let refused = 0;
   async function upload(path, size) {
    const start = performance.now(), bytes = Buffer.alloc(size,size%251), chunks = Math.ceil(size/1000000);
    const r = await a.begin_upload(path,'application/octet-stream',BigInt(size),chunks);
    if ('Err' in r) { refused++; return false; }
    for(let i=0;i<chunks;i++) ok(await a.put_chunk(r.Ok,i,bytes.subarray(i*1000000,(i+1)*1000000)));
    const final = await a.finalize_upload(r.Ok);
    if ('Err' in final) { ok(await a.abort_upload(r.Ok)); refused++; return false; }
    assert.equal(final.Ok.content_hash,hash(bytes)); live.set(path,{size,hash:final.Ok.content_hash}); uploads.push(performance.now()-start); return true;
   }
   async function verify(path) {
    const f = live.get(path); assert.ok(f); const start = performance.now();
    const r = await a.http_request({url:`/${path}`,method:'GET',headers:[],body:[]}); assert.equal(r.status_code,200);
    const parts=[Buffer.from(r.body)]; let token=r.streaming_strategy[0]?.Callback.token, pages=0;
    while(token) { assert.ok(++pages<=Math.ceil(f.size/1000000)+1); const p=await a.http_request_streaming_callback(token); assert.ok(p.body.length<=1000000); parts.push(Buffer.from(p.body)); token=p.token[0]; }
    const bytes=Buffer.concat(parts); assert.equal(bytes.length,f.size); assert.equal(hash(bytes),f.hash); reads.push(performance.now()-start);
   }
   const start=performance.now(); let next=0;
   while(next<scenario.max) {
    const count=Math.min(4,scenario.max-next), base=next; next+=count;
    const batch=await Promise.all(Array.from({length:count},(_,j)=>upload(`users/capacity/${base+j}`,scenario.sizes[(base+j)%scenario.sizes.length])));
    if(batch.every(x=>!x)) break;
   }
   const fillMs=performance.now()-start, usage=await a.get_usage(), status=await a.stable_storage_status(), memoryAtFill=await a.memory_stats();
   assert.equal(usage.total_bytes,BigInt([...live.values()].reduce((s,f)=>s+f.size,0)));
   assert.ok(usage.total_bytes<=BigInt(scenario.ceiling)); assert.ok(refused>0,'must observe actual admission refusal');
   const fillObjects=live.size, samples=[...live.keys()].filter((_,i)=>i<6||i>=fillObjects-2), churn=[...live.entries()].filter((_,i)=>i%2===0);
   for(const path of samples) await verify(path);
   for(let round=0;round<2;round++) {
    for(let i=0;i<churn.length;i+=4) {
     const batch=churn.slice(i,i+4);
     await Promise.all(batch.map(async([path])=>{ok(await a.delete_blob(path));live.delete(path);}));
     await Promise.all(batch.map(async([path,f])=>assert.equal(await upload(path,f.size),true,'same-size churn must reuse space')));
    }
    assert.equal((await a.get_usage()).total_bytes,usage.total_bytes);
    if(scenario.stable) assert.equal((await a.stable_storage_status()).allocated_bytes,status.allocated_bytes);
   }
   const [removedPath,f]=churn[0];ok(await a.delete_blob(removedPath));live.delete(removedPath);
   const pendingPath='users/capacity/interrupted', bytes=Buffer.alloc(f.size,f.size%251);
   const id=ok(await a.begin_upload(pendingPath,'application/octet-stream',BigInt(f.size),Math.ceil(f.size/1000000)));
   ok(await a.put_chunk(id,0,bytes.subarray(0,1000000)));
   await pic.upgradeCanister({canisterId:fixture.canisterId,wasm,sender:governor,upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
   for(let i=1;i<Math.ceil(f.size/1000000);i++) ok(await a.put_chunk(id,i,bytes.subarray(i*1000000,(i+1)*1000000)));
   const final=ok(await a.finalize_upload(id));assert.equal(final.content_hash,hash(bytes));
   assert.ok('Err' in await a.finalize_upload(id), 'local user-path completion removes the upload; read-back verifies publication');
   live.set(pendingPath,{size:f.size,hash:final.content_hash});await verify(pendingPath);
   for(const path of samples) if(live.has(path)) await verify(path);
   assert.equal((await a.get_usage()).total_bytes,usage.total_bytes);
   if(scenario.stable) assert.equal((await a.stable_storage_status()).allocated_bytes,status.allocated_bytes);
   results.push({...scenario,concurrency:4,fillObjects,refused,payloadBytes:usage.total_bytes,physicalHighWaterBytes:status.allocated_bytes,payloadFraction:Number(usage.total_bytes)/scenario.ceiling,baseline,memoryAtFill,memoryAfterChurnAndUpgrade:await a.memory_stats(),fillMs,localFillMiBPerSecond:Number(usage.total_bytes)/1048576/(fillMs/1000),uploadSamples:uploads.length,uploadMedianMs:pct(uploads,.5),uploadP95Ms:pct(uploads,.95),verifiedReads:reads.length,readMedianMs:pct(reads,.5),readP95Ms:pct(reads,.95),simulatedCyclesSpent:startCycles-await pic.getCyclesBalance(fixture.canisterId),sameSizeChurnRounds:2,partialUploadUpgradeRecovered:true});
   console.log(`PASS ${scenario.name}: ${fillObjects} objects; ${usage.total_bytes} payload bytes; ${status.allocated_bytes} physical high-water`);
  } finally {await pic.tearDown();}
 }
 writeFileSync('/tmp/media-realistic-capacity.json',JSON.stringify({environment:'isolated-pocketic',wasmSha256:hash(readFileSync(wasm)),productionCapacityProven:false,results,limitations:['Synthetic ciphertext on existing user-path actor methods; not club entitlement, encryption or UI acceptance.','Legacy 32 MiB and stable 256 MiB/16 MiB bounds; not full 2/32 GiB acceptance.','Assumed workload sizes, not observed customer data; same-size churn only.','No 100,000-record or arbitrary-resize fragmentation proof.','Local time and simulated aggregate cycles are not mainnet throughput/cost or per-operation instructions.','Heap includes buffers, GC, journals and runtime; metadata-only overhead not isolated.','No live flags, settings, deployments or club moves changed.']},(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');
 console.log('PASS report /tmp/media-realistic-capacity.json; full space guarantee NOT certified.');
} finally {await server.stop();}