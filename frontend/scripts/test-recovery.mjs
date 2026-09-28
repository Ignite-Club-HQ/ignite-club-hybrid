// Creates a separate synthetic project. Never reuses the working lab's mappings or state.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { IDL } from '@icp-sdk/core/candid';
import { parse, stringify } from 'yaml';
import { idlFactory, init } from '../src/lab/bindings/declarations/club_links.did.js';
import { syntheticIdentity, syntheticAcl, CLUB_A } from '../src/lab/syntheticIdentities.mjs';
import { lifecycle } from './local-lifecycle.mjs';
const repo=path.resolve(import.meta.dirname,'../..');
const resume=process.argv[2];
if (resume && !/^recovery-test-[A-Za-z0-9]+$/.test(resume)) throw Error('Only a recovery-test directory name is accepted');
const root=resume ? path.join(repo,'.local-icp',resume) : fs.mkdtempSync(path.join(repo,'.local-icp/recovery-test-')); 
const local=path.join(root,'.local-icp'); fs.mkdirSync(local,{recursive:true});
const config=parse(fs.readFileSync(path.join(repo,'icp.yaml'),'utf8'));
config.canisters[0].recipe.configuration.candid=path.join(repo,'backend/club_links/club_links.did');
config.canisters[0].init_args.path=path.join(local,'init.bin');
fs.writeFileSync(path.join(root,'icp.yaml'),stringify(config));
fs.copyFileSync(path.join(repo,'.local-icp/governor.pem'),path.join(local,'governor.pem'));
fs.writeFileSync(path.join(local,'init.bin'),new Uint8Array(IDL.encode(init({IDL}),[syntheticIdentity('governor').getPrincipal(),syntheticAcl()])));
const env={PATH:process.env.PATH,DO_NOT_TRACK:'1',XDG_CONFIG_HOME:path.join(local,'config'),XDG_DATA_HOME:path.join(local,'share'),XDG_CACHE_HOME:path.join(local,'cache')};
function icp(args,capture=false) { return execFileSync('icp',[...args,'--project-root-override',root],{cwd:root,env,encoding:'utf8',stdio:capture?['ignore','pipe','inherit']:'inherit'}); }
const auth=['-n','local','--identity','ignite-lab-governor'];
function publicConfig() {
 const status=JSON.parse(icp(['network','status','local','--json'],true));
 assert.equal(status.managed,true); assert.ok(['http://localhost:4943/','http://127.0.0.1:4943/'].includes(status.api_url));
 const ids=JSON.parse(fs.readFileSync(path.join(root,'.icp/cache/mappings/local.ids.json'),'utf8'));
 const binding={canisterId:ids.club_links,rootKey:status.root_key};
 fs.writeFileSync(path.join(local,'public.json'),JSON.stringify(binding)); return binding;
}
const flow=lifecycle({root,local,icp,publicConfig});
const ok=r=>{assert.ok('Ok' in r,'Err' in r ? r.Err : 'Missing result');return r.Ok;};
const denied=r=>assert.ok('Err' in r);
async function actor(identity,id) {
 const b=publicConfig();
 const agent=await HttpAgent.create({host:'http://127.0.0.1:4943',identity,rootKey:Uint8Array.from(Buffer.from(b.rootKey,'hex')),shouldFetchRootKey:false});
 return Actor.createActor(idlFactory,{agent,canisterId:id??b.canisterId});
}
if (!resume) {
icp(['identity','import','ignite-lab-governor','--from-pem',path.join(local,'governor.pem'),'--storage','plaintext']);
icp(['network','start','local','-d']);
const id=icp(['canister','create','--detached',...auth,'--quiet'],true).trim();
icp(['canister','install',id,...auth,'--mode','install','--wasm',path.join(repo,'target/wasm32-unknown-unknown/release/club_links.wasm'),'--args-file',path.join(local,'init.bin'),'--args-format','bin']);
icp(['canister','link','club_links',id,'-e','local']);
} else flow.start();
const gov=await actor(syntheticIdentity('governor'));
const admin=await actor(syntheticIdentity('club_admin'));
const member=await actor(syntheticIdentity('member'));
const spareIdentity=Ed25519KeyIdentity.generate(new Uint8Array(32).fill(100));
const spare=await actor(spareIdentity);
if (resume && 'Err' in await member.whoami()) {
 const recover=ok(await spare.begin_identity_link(syntheticIdentity('member').getPrincipal()));
 const restored=ok(await member.accept_identity_link(recover.id));
 ok(await member.revoke_identity(spareIdentity.getPrincipal(),restored.version));
}
for (const [index,name] of ['team_member','parent','guardian','excluded_member','excluded_admin','club_admin'].entries()) {
 const source=await actor(syntheticIdentity(name));
 const key=Ed25519KeyIdentity.generate(new Uint8Array(32).fill(110+index));
 const target=await actor(key);
 if ('Ok' in await target.whoami()) ok(await source.revoke_identity(key.getPrincipal(),ok(await source.whoami()).version));
 const c=ok(await source.begin_identity_link(key.getPrincipal()));
 assert.equal(ok(await target.accept_identity_link(c.id)).id,ok(await source.whoami()).id);
 if (name==='excluded_member') denied(await target.list_links(CLUB_A,false));
 else ok(await target.list_links(CLUB_A,false));
 if (['excluded_admin','club_admin'].includes(name)) ok(await target.list_links(CLUB_A,true));
 else denied(await target.list_links(CLUB_A,true));
 ok(await source.revoke_identity(key.getPrincipal(),ok(await source.whoami()).version));
 denied(await target.list_links(CLUB_A,false));
}
const original=ok(await member.whoami());
const challenge=ok(await member.begin_identity_link(spareIdentity.getPrincipal()));
denied(await admin.accept_identity_link(challenge.id));
assert.equal(ok(await spare.accept_identity_link(challenge.id)).id,original.id);
const linked=ok(await spare.whoami());
assert.equal(ok(await spare.accept_identity_link(challenge.id)).id,original.id);
ok(await spare.list_links(CLUB_A,false)); denied(await spare.list_links(CLUB_A,true));
ok(await spare.revoke_identity(syntheticIdentity('member').getPrincipal(),linked.version));
denied(await member.whoami()); denied(await member.list_links(CLUB_A,false));
const last=ok(await spare.whoami()); denied(await spare.revoke_identity(spareIdentity.getPrincipal(),last.version));
if (process.argv[3]==='identities') { await flow.stop(); console.log('PASS: linked team, parent, guardian, excluded member and admin permissions; revocation and account switching.'); process.exit(0); }
const request={club:CLUB_A,request_id:randomUUID(),expected_revision:ok(await admin.list_links(CLUB_A,true)).revision,operation:{Save:{id:[],draft:{title:'Full recovery proof',subtitle:[],url:'https://example.invalid',icon:'link',open_mode:'browser',is_active:true}}}};
const receipt=ok(await admin.mutate(request));
const before={links:ok(await gov.export_links()),acl:ok(await gov.export_acl()),identities:ok(await gov.export_identity_state())};
await flow.backup();
const probe=flow.probe();
async function reconcile(id) {
 const g=await actor(syntheticIdentity('governor'),id), a=await actor(syntheticIdentity('club_admin'),id), s=await actor(spareIdentity,id), m=await actor(syntheticIdentity('member'),id);
 assert.deepEqual(ok(await g.export_links()),before.links);
 assert.deepEqual(ok(await g.export_acl()),before.acl);
 assert.deepEqual(ok(await g.export_identity_state()),before.identities);
 assert.deepEqual(ok(await a.mutate(request)),receipt);
 assert.equal(ok(await s.whoami()).id,original.id); ok(await s.list_links(CLUB_A,false)); denied(await m.list_links(CLUB_A,false));
}
await reconcile(probe);
icp(['canister','install',publicConfig().canisterId,...auth,'--mode','upgrade','--wasm',path.join(repo,'target/wasm32-unknown-unknown/release/club_links.wasm'),'--args','()']);
await reconcile();
for (let n=0;n<2;n++) { await flow.stop(); flow.start(); await reconcile(); }
await flow.stop();
console.log(`PASS: signed linking/revocation, complete fresh-canister recovery and two network restarts. Artifacts: ${root}`);
