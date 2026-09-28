import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filesDigest, verifyBackup } from '../scripts/snapshot-files.mjs';
import { lifecycle } from '../scripts/local-lifecycle.mjs';

test('full recovery rejects corrupted, extra, missing and symlinked snapshot files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ignite-snapshot-test-'));
 try {
  const snap=path.join(root,'snapshot');fs.mkdirSync(snap);
  const file=path.join(snap,'stable_memory.bin');fs.writeFileSync(file,'synthetic');
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({format:1,network:'local',canisterId:'synthetic',files:filesDigest(snap)}));
  verifyBackup(root);
  fs.writeFileSync(file,'corrupted');assert.throws(()=>verifyBackup(root),/checksum/);
  fs.writeFileSync(file,'synthetic');fs.writeFileSync(path.join(snap,'extra'),'x');assert.throws(()=>verifyBackup(root),/checksum/);
  fs.unlinkSync(path.join(snap,'extra'));fs.unlinkSync(file);assert.throws(()=>verifyBackup(root),/checksum/);
  fs.symlinkSync(path.join(root,'manifest.json'),file);assert.throws(()=>verifyBackup(root),/symlinks/);
  fs.unlinkSync(file);fs.rmdirSync(snap);fs.symlinkSync(root,snap);assert.throws(()=>verifyBackup(root),/real directory/);
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('multi-canister recovery validates every named snapshot independently',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ignite-multi-snapshot-test-'));
 try {
  const first=path.join(root,'club_links');const second=path.join(root,'identity_access');fs.mkdirSync(first);fs.mkdirSync(second);
  fs.writeFileSync(path.join(first,'stable.bin'),'club');fs.writeFileSync(path.join(second,'stable.bin'),'identity');
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({format:2,network:'local',canisters:{club_links:{canisterId:'club',snapshotId:'a',files:filesDigest(first)},identity_access:{canisterId:'identity',snapshotId:'b',files:filesDigest(second)}},files:{format:'multi-canister'}}));
  verifyBackup(root);
  fs.writeFileSync(path.join(second,'stable.bin'),'corrupted');
  assert.throws(()=>verifyBackup(root),/identity_access/);
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('stale cached network status cannot bypass missing recovery snapshot protection',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ignite-lifecycle-test-'));
 try {
  const local=path.join(root,'.local-icp');fs.mkdirSync(local);fs.writeFileSync(path.join(local,'public.json'),'{}');
  const network=path.join(root,'.icp/cache/networks/local');fs.mkdirSync(network,{recursive:true});
  fs.writeFileSync(path.join(network,'descriptor.json'),JSON.stringify({'child-locator':{pid:99999999,'start-time':0}}));
  const calls=[];
  const flow=lifecycle({root,local,publicConfig:()=>{throw Error('unexpected');},icp:args=>{calls.push(args);return JSON.stringify({managed:true});}});
  assert.throws(()=>flow.start(),/No current full shutdown snapshot/);
  assert.deepEqual(calls,[['network','status','local','--json']]);
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
