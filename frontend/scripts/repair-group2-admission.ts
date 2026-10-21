/** Protected, journaled identity-only upgrade and Group 2 reader repair.
 * Never installs a new canister, rewires services, sets flags, or opens placement. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { ADMISSION_DOMAINS, ADMISSION_FLAG, ADMISSION_AUTHORITY } from '../src/live/groupRemovalWiring';
import { createJournalApi } from './media-stage-two-github.mjs';
import { persistGroup2Journal } from '../../scripts/group2-journal.mjs';
import { wasmHash } from '../../scripts/group2-upgrade-rules.mjs';
import { IDENTITY, ROUTER, GOVERNOR, digest, validateRequest, verifyIdentityStatus, reconcileIdentityUpgrade } from '../../scripts/group2-admission-release-rules.mjs';

const [action, wasmFile, pem, directory] = process.argv.slice(2);
validateRequest(action, process.env.CONFIRMATION);
if (!wasmFile || !pem || !directory) throw new Error('Usage: repair-group2-admission <check|repair|disable> <wasm> <key-file> <report-directory>');
const root = new URL('../../', import.meta.url);
const ids = JSON.parse(readFileSync(new URL('deploy/mainnet/.icp/data/mappings/ic.ids.json', root), 'utf8'));
if (ids.identity_access !== IDENTITY || ids.shard_router !== ROUTER) throw new Error('Pinned existing mainnet identity/router required');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GOVERNOR) throw new Error('Existing governor required');
mkdirSync(directory, {recursive:true});
const agent = await HttpAgent.create({host:'https://icp-api.io',identity});
const pid = (id:string) => Principal.fromText(id);
const ok = <T>(r:{Ok:T}|{Err:string}):T => {if ('Err' in r) throw new Error(r.Err);return r.Ok;};
const mgmtIdl = () => IDL.Service({canister_status:IDL.Func([IDL.Record({canister_id:IDL.Principal})],[IDL.Record({
  status:IDL.Variant({running:IDL.Null,stopped:IDL.Null,stopping:IDL.Null}),module_hash:IDL.Opt(IDL.Vec(IDL.Nat8)),cycles:IDL.Nat,
  settings:IDL.Record({controllers:IDL.Vec(IDL.Principal),environment_variables:IDL.Vec(IDL.Record({name:IDL.Text,value:IDL.Text}))})})],[])});
type Status={status:Record<string,null>;module_hash:[]|[Uint8Array];cycles:bigint;settings:{controllers:Principal[];environment_variables:{name:string;value:string}[]}};
const status = async (id:string):Promise<Status> => {
  const a=Actor.createActor(mgmtIdl,{agent,canisterId:'aaaaa-aa',effectiveCanisterId:pid(id)} as Parameters<typeof Actor.createActor>[1]) as unknown as {canister_status(a:{canister_id:Principal}):Promise<Status>};
  return a.canister_status({canister_id:pid(id)});
};
const observe=async()=> {
  const s=await status(IDENTITY);
  const c=await CanisterStatus.request({agent,canisterId:pid(IDENTITY),paths:['subnet']});
  const subnet=c.get('subnet') as {subnetId?:Principal|string}|undefined;
  const value={moduleHash:Buffer.from(s.module_hash[0]??[]).toString('hex'),controllers:s.settings.controllers.map(p=>p.toText()),
    running:'running' in s.status,cycles:s.cycles,environment:s.settings.environment_variables};
  verifyIdentityStatus(value);
  if (!subnet?.subnetId) throw new Error('Identity certified subnet missing');
  return {...value,subnetId:String(subnet.subnetId),settingsHash:digest([...value.environment].sort((a,b)=>a.name.localeCompare(b.name)))};
};
const unit=IDL.Variant({Ok:IDL.Null,Err:IDL.Text}), rows=IDL.Vec(IDL.Tuple(IDL.Text,IDL.Text));
const bindingIdl=IDL.Record({registry:IDL.Principal,registry_revision:IDL.Nat64,target_alias:IDL.Text,deployment_id:IDL.Text,
  deployment_revision:IDL.Nat64,host:IDL.Text,network_kind:IDL.Text});
const account=Actor.createActor(()=>IDL.Service({authorize_group2_admission:IDL.Func([bindingIdl],[unit],[]),disable_group2_admission:IDL.Func([],[unit],[]),
  read_group_opening_configuration:IDL.Func([],[IDL.Variant({Ok:rows,Err:IDL.Text})],[])}),{agent,canisterId:IDENTITY}) as unknown as {
    authorize_group2_admission(b:unknown):Promise<{Ok:null}|{Err:string}>;disable_group2_admission():Promise<{Ok:null}|{Err:string}>;
    read_group_opening_configuration():Promise<{Ok:[string,string][]}|{Err:string}>};
const router=Actor.createActor<_SERVICE>(routerIdl,{agent,canisterId:ROUTER});
const registry=()=>readPinnedGroupRegistry((rev,cursor,limit)=>router.read_group_registry_page('mainnet',rev,cursor,limit));
const newHash=wasmHash(readFileSync(wasmFile));
const original=await observe();
const live=await registry();
const group=live.groups.find(g=>g.id==='g2'),placement=live.placements.find(p=>p.group_id==='g2');
if (!group || !placement || placement.deployment_id!=='mainnet' || placement.host!=='https://icp-api.io' || placement.network_kind!=='public_mainnet') throw new Error('Exact registered mainnet Group 2 required');
const targets:{name:string;id:string|undefined}[]=ADMISSION_DOMAINS.map(name=>({name,id:group.domains.find(d=>d.domain===name)?.canister.toText()}));
targets.push({name:'media_blob_store',id:group.photo_store[0]?.toText()});
if(targets.some(t=>!t.id)||new Set(targets.map(t=>t.id)).size!==12)throw new Error('Complete 12 Group 2 admission services required');
const provision=JSON.parse(readFileSync(new URL('deploy/groups/g2/provision.json',root),'utf8'));
const approval=JSON.parse(readFileSync(new URL('deploy/groups/g2/general-opening.json',root),'utf8'));
for(const t of targets){
  if(!t.id)throw new Error('Missing service');
  const provisionId=t.name==='media_blob_store'?provision.dedicatedBlobStore?.canisterId:provision.canisters?.[t.name];
  const approved=approval.services?.find((s:{name:string})=>s.name===t.name);
  const s=await status(t.id);
  const hash=Buffer.from(s.module_hash[0]??[]).toString('hex');
  const get=(k:string)=>{const hits=s.settings.environment_variables.filter(e=>e.name===k);return hits.length===1?hits[0].value:undefined;};
  if(t.id!==provisionId || approved?.canisterId!==t.id || approved.moduleHash!==hash ||
      s.settings.controllers.length!==1 || s.settings.controllers[0].toText()!==GOVERNOR || !('running' in s.status) ||
      get(ADMISSION_FLAG)!=='1' || get(ADMISSION_AUTHORITY)!==IDENTITY)throw new Error(`Unverified Group 2 destination: ${t.name}`);
}
const binding={registry:pid(ROUTER),registry_revision:live.revision,target_alias:'mainnet',deployment_id:'mainnet',deployment_revision:placement.deployment_revision,
  host:'https://icp-api.io',network_kind:'public_mainnet'};
const publicReport={action,identity:IDENTITY,newHash,oldHash:original.moduleHash,subnetId:original.subnetId,
  registryRevision:String(live.revision),groupAccepting:group.accepting,readers:targets};
writeFileSync(join(directory,'account-access-report.json'),JSON.stringify(publicReport,null,2));
if(action==='check') {console.log('Identity-only repair preflight passed; no deployment or authorization performed.');process.exit(0);}
const repo=process.env.GITHUB_REPOSITORY,release=process.env.GITHUB_SHA;
if(!repo || !release || !/^[a-f0-9]{40}$/.test(release))throw new Error('GitHub release binding required');
const api=createJournalApi(repo,JSON.stringify),branch='group-2-upgrade-receipts';
if(!api(`git/matching-refs/heads/${branch}`).some((r:{ref:string})=>r.ref===`refs/heads/${branch}`)){
  const meta=api(''),base=api(`git/ref/heads/${meta.default_branch}`);api('git/refs','POST',{ref:`refs/heads/${branch}`,sha:base.object.sha});
}
const path=`contents/deploy/groups/g2/account-access-${action}.json`;
const list=api(`contents/deploy/groups/g2?ref=${branch}`);
let stored=list.some((e:{name:string})=>e.name===`account-access-${action}.json`)?api(`${path}?ref=${branch}`):null;
type Journal={bindingHash:string;phase:string;step:{phase:string;oldHash:string;newHash:string;settingsHash:string;subnetId:string}};
const bindingHash=digest({identity:IDENTITY,router:ROUTER,newHash,readers:targets,governor:GOVERNOR,action});
let journal:Journal=stored?JSON.parse(Buffer.from(stored.content,'base64').toString()):{bindingHash,phase:'upgrade',step:{phase:'ready',oldHash:original.moduleHash,
  newHash,settingsHash:original.settingsHash,subnetId:original.subnetId}};
if(journal.bindingHash!==bindingHash)throw new Error('Different account-access release journal exists; review before changing release');
const persist=()=>{stored=persistGroup2Journal(api,path,branch,stored,journal,'account-access');writeFileSync(join(directory,'account-access-progress.json'),JSON.stringify(journal,null,2));};
if(!stored)persist();
if(action==='repair'){
  journal.step=reconcileIdentityUpgrade(journal.step,await observe());
  if(journal.step.phase!=='complete'){
    if((await registry()).revision!==live.revision)throw new Error('Registry changed before identity upgrade');
    journal.step.phase='pending';persist();
    const result=spawnSync('icp',['canister','install',IDENTITY,'-n','ic','--mode','upgrade','--wasm',resolve(wasmFile),
      '--args',`(record { governor = principal "${GOVERNOR}" })`,'-y'],{cwd:directory,stdio:'inherit'});
    if(result.status!==0)throw new Error('Identity upgrade outcome unknown; journal retained, no automatic replay');
    const after=await observe();verifyIdentityStatus(after,newHash);journal.step=reconcileIdentityUpgrade(journal.step,after);persist();
  }
  if((await registry()).revision!==live.revision)throw new Error('Registry changed before admission authorization');
  // Exact registry-derived authorization is atomic/idempotent; replay never
  // accepts a supplied arbitrary reader list or releases broader lifecycle.
  journal.phase='authorize';persist();ok(await account.authorize_group2_admission(binding));
}else{journal.phase='disable';persist();ok(await account.disable_group2_admission());}
const evidence=ok(await account.read_group_opening_configuration());
const enabled=evidence.find(r=>r[0]==='account_admission_released')?.[1];
if(action==='repair' && (enabled!=='true'||targets.some(t=>!evidence.some(r=>r[0]==='eligibility_authority'&&r[1]===t.id))))throw new Error('Admission authorization readback failed');
if(action==='disable' && enabled!=='false')throw new Error('Admission disable readback failed');
if((await registry()).revision!==live.revision)throw new Error('Registry changed during account-access repair');
journal.phase='complete';persist();
writeFileSync(join(directory,'account-access-report.json'),JSON.stringify({...publicReport,verified:true,evidence},null,2));
console.log(action==='repair'?'Identity upgraded and exact Group 2 readers authorized; group placement state and other services unchanged.':'Group 2 account eligibility disabled; placement state unchanged.');