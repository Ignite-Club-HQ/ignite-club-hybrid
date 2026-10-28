/** Upgrade existing reviewed services across the complete mainnet inventory only. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { groupApprovalConfiguration } from '../src/live/groupApproval';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { idlFactory as placementIdl } from '../src/lab/bindings/placement_registry/declarations/placement_registry.did.js';
import { idlFactory as migrationIdl } from '../src/lab/bindings/migration_coordinator/declarations/migration_coordinator.did.js';
import { idlFactory as workloadIdl } from '../src/lab/bindings/secret_workload_identity/declarations/secret_workload_identity.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import type { _SERVICE as IdentityService } from '../src/lab/bindings/identity_access/declarations/identity_access.did';
import type { _SERVICE as PlacementService } from '../src/lab/bindings/placement_registry/declarations/placement_registry.did';
import type { _SERVICE as MigrationService } from '../src/lab/bindings/migration_coordinator/declarations/migration_coordinator.did';
import type { _SERVICE as WorkloadService } from '../src/lab/bindings/secret_workload_identity/declarations/secret_workload_identity.did';
import { createJournalApi } from './media-stage-two-github.mjs';
import { persistGroup2Journal } from '../../scripts/group2-journal.mjs';
import { GROUP2_GOVERNOR, verifyUpgradeStatus, wasmHash } from '../../scripts/group2-upgrade-rules.mjs';
import { placementOperatorEvidenceIdl, normalizePlacementOperatorEvidence } from '../../scripts/placement-upgrade-evidence.mjs';
import { legacyClubLifecycleDisabled, validateClubIdentityWiring, groupPermissionRequirement, approvedDisplayLinkRows } from '../../scripts/all-group-wiring-policy.mjs';
import { digest, validateRequest, planInventory, installArgs, validateJournal, requireSettledPredecessor, requireSettledNarrowRelease, assertCheckedPlan, executeUpgrades, requireCompletedRecovery, galleryAuthorities, verifyCompletedRecovery, normalizePlan } from '../../scripts/all-group-upgrade-policy.mjs';
import { CLEANUP_RELEASE, cleanupEnvironment, requireCleanupWiring, activateCleanupSettings, canonicalSettingRows, supersedableSettingsStage } from '../../scripts/private-name-cleanup-release-policy.mjs';
import { isSecureNameScope, secureNameEnvironment, secureNameChangedSettings } from '../../scripts/secure-name-release-policy.mjs';
import { settlePublishedEvidence } from '../../scripts/all-group-publication.mjs';

const [action, scope, artifacts, pem, directory] = process.argv.slice(2);
const CHECKED_PLAN = process.env.CHECKED_PLAN ? normalizePlan(process.env.CHECKED_PLAN) : process.env.CHECKED_PLAN;
const services = validateRequest(action, scope, process.env.CONFIRMATION, CHECKED_PLAN);
const cleanupRelease = scope === 'private_name_cleanup';
const secureRelease = isSecureNameScope(scope);
const settingsRelease = cleanupRelease || secureRelease;
if (!artifacts || !pem || !directory) throw Error('Artifacts, existing key and report directory required');
const root = new URL('../../', import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const shared = json('deploy/mainnet/.icp/data/mappings/ic.ids.json');
const releaseEnvironment=(rows:{name:string;value:string}[],service:string)=>secureRelease?secureNameEnvironment(rows,service,scope,{identity:shared.identity_access,originalPii:shared.pii_access_control}):cleanupEnvironment(rows,service);
const changedSettings=(service:string)=>secureRelease?secureNameChangedSettings(scope,service):[CLEANUP_RELEASE];
const groupRoot = new URL('deploy/groups/', root);
const groupFolders = readdirSync(groupRoot, { withFileTypes: true }).filter(e=>e.isDirectory() && /^g[1-9][0-9]*$/.test(e.name));
const provisions = groupFolders.filter(e=>existsSync(new URL(`${e.name}/provision.json`,groupRoot))).map(e=>json(`deploy/groups/${e.name}/provision.json`));
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText()!==GROUP2_GOVERNOR) throw Error('Original governor required');
mkdirSync(directory,{recursive:true});
const agent=await HttpAgent.create({host:'https://icp-api.io',identity});
const router=Actor.createActor<_SERVICE>(idlFactory,{agent,canisterId:shared.shard_router});
const registry=()=>readPinnedGroupRegistry((rev,cursor,limit)=>router.read_group_registry_page('mainnet',rev,cursor,limit));
const initial=await registry();
const repo=process.env.GITHUB_REPOSITORY, source=process.env.GITHUB_SHA;
if (!repo || !/^[a-f0-9]{40}$/.test(source ?? '')) throw Error('GitHub source revision required');
const api=createJournalApi(repo,JSON.stringify);
const recoveryStored=action==='recover'?api('contents/all-group-upgrade.json?ref=all-group-upgrade-receipts'):null;
const recoveryJournal=recoveryStored?JSON.parse(Buffer.from(recoveryStored.content,'base64').toString()):null;
const recovery=action==='recover'?requireCompletedRecovery(recoveryJournal,{repo,scope,checkedPlan:CHECKED_PLAN,source,branch:process.env.GITHUB_REF}):null;
const release=recovery?.release??source;
const hashes=recovery?.hashes??Object.fromEntries(services.map((name:string)=>[name,wasmHash(readFileSync(resolve(artifacts,name)))]));
const inventory=planInventory(shared,provisions,initial,scope,hashes);
type Target={groupId:string;name:string;canisterId:string;subnetId:string;newHash:string};
const targets:Target[]=inventory.targets;
const configuration=groupApprovalConfiguration(initial.groups,initial.placements);
const branch='all-group-upgrade-receipts', path='contents/all-group-upgrade.json';
const refs=api('git/matching-refs/heads/');
const branchExists=(name:string)=>refs.some((r:{ref:string})=>r.ref===`refs/heads/${name}`);
// Existing narrow workflows may have interrupted writes; no new journal bypass.
const predecessors=[['competition-upgrade-receipts','competition-upgrade.json'],['subscription-upgrade-receipts','subscription-upgrade.json'],['team-invite-upgrade-receipts','team-invite-upgrade.json'],['messaging-upgrade-receipts','messaging-upgrade.json'],['history-upgrade-receipts','history-upgrade.json'],['media-paging-upgrade-receipts','media-paging-upgrade.json'],['membership-lookup-release-receipts','membership-lookup-release.json'],
  ...inventory.groups.filter((g:{id:string})=>g.id!=='g1').map((g:{id:string})=>[g.id==='g2'?'group-2-upgrade-receipts':`group-${g.id.slice(1)}-receipts`,`deploy/groups/${g.id}/upgrade-progress.json`])];
for (const [b,p] of predecessors) if (branchExists(b)) {
  const tree=api(`git/trees/${b}?recursive=1`);
  if (tree.truncated) throw Error('Release journal inventory incomplete');
  if (tree.tree.some((e:{path:string})=>e.path===p)) {
    const entry=api(`contents/${p}?ref=${b}`);
    const old=JSON.parse(Buffer.from(entry.content,'base64').toString());
    requireSettledNarrowRelease(b,old);
  }
}
let stored:any=null;
if (branchExists(branch)) {
  const tree=api(`git/trees/${branch}?recursive=1`);
  if(tree.truncated)throw Error('Active journal inventory incomplete');
  if(tree.tree.some((e:{path:string})=>e.path==='all-group-upgrade.json'))stored=api(`${path}?ref=${branch}`);
}
let journal:any=stored?JSON.parse(Buffer.from(stored.content,'base64').toString()):null;
if(recovery && (!journal || digest(journal)!==digest(recoveryJournal)))throw Error('Recovery journal changed during readback');
const mgmtIdl=()=>IDL.Service({canister_status:IDL.Func([IDL.Record({canister_id:IDL.Principal})],[IDL.Record({status:IDL.Variant({running:IDL.Null,stopped:IDL.Null,stopping:IDL.Null}),module_hash:IDL.Opt(IDL.Vec(IDL.Nat8)),cycles:IDL.Nat,settings:IDL.Record({controllers:IDL.Vec(IDL.Principal),compute_allocation:IDL.Nat,memory_allocation:IDL.Nat,freezing_threshold:IDL.Nat,reserved_cycles_limit:IDL.Nat,wasm_memory_limit:IDL.Nat,environment_variables:IDL.Vec(IDL.Record({name:IDL.Text,value:IDL.Text}))})})],[])});
const observe=async(t:Target)=>{
  const cid=Principal.fromText(t.canisterId);
  const mgmt=Actor.createActor(mgmtIdl,{agent,canisterId:'aaaaa-aa',effectiveCanisterId:cid} as Parameters<typeof Actor.createActor>[1]) as unknown as {canister_status(a:{canister_id:Principal}):Promise<any>};
  const status=await mgmt.canister_status({canister_id:cid});
  const certified=await CanisterStatus.request({agent,canisterId:cid,paths:['subnet']});
  const subnet=certified.get('subnet') as {subnetId?:Principal}|undefined;
  const actual={moduleHash:Buffer.from(status.module_hash[0]??[]).toString('hex'),controllers:status.settings.controllers.map((p:Principal)=>p.toText()),running:'running' in status.status,cycles:status.cycles,subnetId:String(subnet?.subnetId??''),environment:status.settings.environment_variables};
  verifyUpgradeStatus(t,actual,GROUP2_GOVERNOR);
  const settings={...status.settings,controllers:actual.controllers,environment_variables:canonicalSettingRows(actual.environment)};
  const rawSettingsHash=digest(settings);
  let cleanupSettingsHash:string|undefined;
  if(settingsRelease) cleanupSettingsHash=digest({...settings,environment_variables:canonicalSettingRows(releaseEnvironment(actual.environment,t.name))});
  const normalized=settingsRelease?{...settings,environment_variables:settings.environment_variables.filter((r:{name:string})=>!changedSettings(t.name).includes(r.name))}:settings;
  return {moduleHash:actual.moduleHash,settingsHash:digest(normalized),rawSettingsHash,cleanupSettingsHash,settingsSettled:settingsRelease?cleanupSettingsHash===rawSettingsHash:undefined,cycles:String(actual.cycles),legacyLifecycleDisabled:legacyClubLifecycleDisabled(actual.environment)};
};
const readConfig=async(t:Target)=>{
  const rows=IDL.Vec(IDL.Tuple(IDL.Text,IDL.Text));
  const factory=()=>IDL.Service({read_group_opening_configuration:IDL.Func([],[t.name==='timer_jobs'?IDL.Variant({Ok:rows,Err:IDL.Text}):rows],[])});
  const actor=Actor.createActor(factory,{agent,canisterId:t.canisterId}) as unknown as {read_group_opening_configuration():Promise<[string,string][]|{Ok:[string,string][]}|{Err:string}>};
  const reply=await actor.read_group_opening_configuration();
  if(!Array.isArray(reply)&&'Err'in reply)throw Error('Original configuration unavailable');
  return (Array.isArray(reply)?reply:reply.Ok).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
};
const wiring:Record<string,string>={};
const LEGACY_G1_CLUB='mzzzv-taaaa-aaaal-qxlrq-cai';
const displayLinks:Target[]=[];
const displayLinkRows:Record<string,[string,string][]>={};
const legacySettings:Record<string,string>={};
const identityActor=Actor.createActor<IdentityService>(identityIdl,{agent,canisterId:shared.identity_access});
const cleanupIdentityEvidence=async()=>{
  const r=await identityActor.read_membership_directory_configuration();
  if('Err'in r)throw Error('Cleanup identity directory configuration unavailable; no settings changed');
  const c=r.Ok;
  const b=c.binding;
  const expected=inventory.groups.map((g:{id:string;services:{name:string;canisterId:string}[]})=>[g.id,g.services.find(s=>s.name==='club_domain')?.canisterId]);
  if(!c.enabled || b.registry.toText()!==shared.shard_router || b.registry_revision!==initial.configurationRevision || b.target_alias!=='mainnet'||b.deployment_id!=='mainnet'||b.host!=='https://icp-api.io'||b.network_kind!=='public_mainnet'||c.sources.length!==expected.length||expected.some(([id,cid])=>c.sources.filter(([group,p])=>group===id&&p.toText()===cid).length!==1))throw Error('Cleanup requires existing complete matching identity directory; do not repin or reconfigure');
  return c;
};
if(cleanupRelease)wiring[shared.identity_access]=digest(await cleanupIdentityEvidence());
const readSharedEvidence=async(t:Target)=>{
  if(t.name==='shard_router')return router.read_group_opening_configuration();
  if(t.name==='placement_registry'){
    const actor=Actor.createActor<PlacementService>(placementIdl,{agent,canisterId:t.canisterId});
    const operator=Actor.createActor(()=>placementOperatorEvidenceIdl(IDL),{agent,canisterId:t.canisterId}) as unknown as {get_operator(user:Principal):Promise<unknown>};
    return {version:await actor.version(),availability:await actor.get_availability(),governor:normalizePlacementOperatorEvidence(await operator.get_operator(identity.getPrincipal()))};
  }
  if(t.name==='migration_coordinator')return Actor.createActor<MigrationService>(migrationIdl,{agent,canisterId:t.canisterId}).status();
  if(t.name==='secret_workload_identity'){
    const rows=await Actor.createActor<WorkloadService>(workloadIdl,{agent,canisterId:t.canisterId}).list_workloads();
    return rows.map(row=>({principal:row.workload_principal.toText(),name:row.workload_name,scopes:[...row.allowed_scopes].sort(),status:row.status,registered:row.registered_at})).sort((a,b)=>a.principal.localeCompare(b.principal));
  }
  return null;
};
for(const t of targets.filter(t=>t.groupId==='shared'&&t.name!=='identity_access'))wiring[t.canisterId]=digest(await readSharedEvidence(t));
for(const t of targets.filter(t=>t.groupId!=='shared')){
  const rows=await readConfig(t);
  // Preserve actual preflight evidence even when a required authority differs.
  // Public canister wiring only; never management environment values or secrets.
  writeFileSync(join(directory,`${t.groupId}-${t.name}-wiring.json`),JSON.stringify({groupId:t.groupId,service:t.name,canisterId:t.canisterId,rows},null,2));
  const group=inventory.groups.find((g:{id:string})=>g.id===t.groupId);
  if(!group)throw Error('Missing owning group');
  const own=(name:string)=>group.services.find((s:{name:string})=>s.name===name)?.canisterId;
  const requireRow=(name:string,expected:string|undefined)=>{if(!expected||rows.filter(r=>r[0]===name&&r[1]===expected).length!==1)throw Error(`Owning-group wiring differs: ${t.groupId}/${t.name}/${name}; expected ${expected??'missing inventory'}, reported ${JSON.stringify(rows.filter(r=>r[0]===name))}. Full readback saved in ${t.groupId}-${t.name}-wiring.json; no authority changes applied.`);};
  const permission=groupPermissionRequirement(t.name,own('club_domain'));
  if(permission)requireRow(permission[0],permission[1]);
  if(t.name==='club_domain'){
    if(cleanupRelease || secureRelease){const legacyDisplay=scope==='private_club_name_display'&&t.groupId==='g1'&&t.canisterId===LEGACY_G1_CLUB;if(requireCleanupWiring(t.name,rows,shared.identity_access,legacyDisplay)==='link'){displayLinks.push(t);displayLinkRows[t.canisterId]=approvedDisplayLinkRows(t,rows,shared.identity_access);}}
    // The original G1 authority predates group lifecycle wiring. Its empty
    // singleton must be preserved, never configured by an upgrade. Verify
    // disabled settings via controller readback, not a guessed group label.
    const legacy=rows.some(r=>r[0]==='identity_access'&&r[1]==='');
    const status=legacy?await observe(t):null;
    const disabled=status?.legacyLifecycleDisabled??false;
    validateClubIdentityWiring(t,rows,shared.identity_access,disabled);
    if(status)legacySettings[t.canisterId]=status.settingsHash;
    requireRow('notification_queue',own('notification_queue'));requireRow('events_domain',own('events_domain'));
  }
  if(t.name==='notification_queue'){requireRow('identity_access',shared.identity_access);requireRow('messaging_domain',own('messaging_domain'));}
  if(t.name==='events_domain'){requireRow('notification_queue',own('notification_queue'));requireRow('competition_domain',own('competition_domain'));}
  if(t.name==='competition_domain')requireRow('events_domain',own('events_domain'));
  if(t.name==='club_domain' || t.name==='competition_domain'){
    const role=t.name==='club_domain'?'competition_authority':'participant_club_authority';
    const direct=t.name==='club_domain'?'competition_domain':'club_domain';
    if(!rows.some(r=>(r[0]===role||r[0]===direct)&&r[1]===own(direct)))throw Error('Reciprocal same-group authority missing');
  }
  wiring[t.canisterId]=digest(rows);
}
const observations=[];
for(const t of targets)observations.push({...t,...await observe(t)});
const freshCleanupPlan=settingsRelease?observations.map(s=>({canisterId:s.canisterId,name:s.name,groupId:s.groupId,subnetId:s.subnetId,newHash:s.newHash,oldSettingsHash:s.rawSettingsHash,newSettingsHash:s.cleanupSettingsHash})):undefined;
const retainedCleanupPlan=settingsRelease&&journal?.binding?.release===release&&journal?.binding?.scope===scope?journal.binding.cleanupPlan:undefined;
const cleanupPlan=retainedCleanupPlan??freshCleanupPlan;
if(settingsRelease && (!Array.isArray(cleanupPlan)||cleanupPlan.length!==targets.length||targets.some(t=>{
  const matches=cleanupPlan.filter((s:any)=>s.canisterId===t.canisterId&&s.name===t.name&&s.groupId===t.groupId&&s.subnetId===t.subnetId&&s.newHash===t.newHash);
  const observed=observations.find(o=>o.canisterId===t.canisterId);
  return matches.length!==1||!observed||matches[0].newSettingsHash!==observed.cleanupSettingsHash||![matches[0].oldSettingsHash,matches[0].newSettingsHash].includes(observed.rawSettingsHash);
})))throw Error('Foreign cleanup activation plan or settings drift');
const binding={repo,release,scope,...(scope==='full_backend'?{upgradeUnchanged:true}:{}),...(settingsRelease?{cleanupPlan}:{}),governor:GROUP2_GOVERNOR,host:'https://icp-api.io',router:shared.shard_router,configurationRevision:String(initial.configurationRevision),configuration,targets,pii:inventory.pii,wiring};
const planHash=digest(binding);
const same=journal&&digest(journal.binding)===planHash;
if(recovery&&!same)throw Error('Live recovery plan differs from the original release; no installs permitted');
if(journal&&!same){
  // A completed release whose main-branch evidence push was reverted by the
  // two-way sync settles once the exact snapshot files reached main through the
  // normal edit/sync path. This never replays installs and never pushes to main.
  if(journal.complete===true&&journal.published!==true&&journal.publication){
    settlePublishedEvidence(api,process.env.GITHUB_REF,journal);
    journal.published=true;
    stored=persistGroup2Journal(api,path,branch,stored,journal,'publication settled');
  }
  const settledNow=new Map(observations.map(o=>[o.canisterId,o.settingsSettled]));
  if(!(settingsRelease&&supersedableSettingsStage(journal,scope,(id:string)=>settledNow.get(id)))) requireSettledPredecessor(journal);
}
const gate=async()=>{
  const current=await registry();
  if(current.configurationRevision!==initial.configurationRevision||groupApprovalConfiguration(current.groups,current.placements)!==configuration)throw Error('Routing configuration drift; stop without replay');
  planInventory(shared,provisions,current,scope,hashes);
  for(const t of targets.filter(t=>t.groupId!=='shared')){
    const link=journal?.displayIdentityLinks?.[t.canisterId];
    const expected=link?.phase==='complete'?link.afterHash:wiring[t.canisterId];
    if(link && (link.beforeHash!==wiring[t.canisterId]||link.afterHash!==digest(displayLinkRows[t.canisterId])))throw Error('Foreign display identity link receipt');
    if(digest(await readConfig(t))!==expected)throw Error('Original wiring changed; stop');
  }
  for(const t of targets.filter(t=>Object.hasOwn(legacySettings,t.canisterId))){const status=await observe(t);if(!status.legacyLifecycleDisabled||status.settingsHash!==legacySettings[t.canisterId])throw Error('Legacy lifecycle settings changed; stop without rewiring');}
  for(const t of targets.filter(t=>t.groupId==='shared'&&t.name!=='identity_access'))if(digest(await readSharedEvidence(t))!==wiring[t.canisterId])throw Error('Shared infrastructure configuration changed; stop without replay');
  if(cleanupRelease&&digest(await cleanupIdentityEvidence())!==wiring[shared.identity_access])throw Error('Cleanup identity configuration changed; retain release intent');
};
const keyGate=(groupId:string,phase:string)=>{
  const mapping=join(directory,`${groupId}-pii.json`), receipt=join(directory,`${groupId}-original-key.json`);
  writeFileSync(mapping,JSON.stringify({pii_access_control:inventory.pii[groupId]}));
  const r=spawnSync(process.execPath,[new URL('media-key-deploy-preflight.mjs',import.meta.url).pathname,phase,mapping,receipt,'mainnet','ic'],{env:{...process.env,GOVERNOR:GROUP2_GOVERNOR,DEPLOYER_PEM_FILE:resolve(pem)},stdio:'inherit'});
  if(r.status!==0)throw Error('Original photo-key verification failed');
  return JSON.parse(readFileSync(receipt,'utf8'));
};
if(cleanupRelease) {
  // PII identity is a protected existing setting, not an upgrade-time setter.
  // The helper never invents it; the live check below requires it exactly.
  for(const t of targets.filter(t=>t.name==='pii_access_control')) {
    const cid=Principal.fromText(t.canisterId);
    const mgmt=Actor.createActor(mgmtIdl,{agent,canisterId:'aaaaa-aa',effectiveCanisterId:cid} as Parameters<typeof Actor.createActor>[1]) as unknown as {canister_status(a:{canister_id:Principal}):Promise<any>};
    const s=await mgmt.canister_status({canister_id:cid});
    const rows=s.settings.environment_variables.filter((r:{name:string})=>r.name==='IGNITE_PRIVATE_PROFILE_IDENTITY');
    if(rows.length!==1 || rows[0].value!==shared.identity_access)throw Error('Cleanup requires existing exact PII identity setting; no automatic authority changes');
  }
}
if(same){validateJournal(journal,binding);for(const k of journal.keys)writeFileSync(join(directory,`${k.groupId}-original-key.json`),JSON.stringify(k.receipt));}
else journal=null;
await gate();
const keys=journal?.keys??Object.keys(inventory.pii).map(groupId=>({groupId,receipt:keyGate(groupId,'before')}));
for(const k of keys)keyGate(k.groupId,'after');
const saveReport=(name:string,data:unknown)=>writeFileSync(join(directory,name),JSON.stringify(data,(_,v)=>typeof v==='bigint'?String(v):v,2));
saveReport('check.json',{planHash,binding,targets:observations,liveAcceptance:false});
console.log(`Checked ${inventory.groups.length} groups, ${targets.length} targets. Checked plan hash: ${planHash}`);
if(action==='check'){await gate();process.exit(0);}
assertCheckedPlan(CHECKED_PLAN,planHash);
if(!branchExists(branch))api('git/refs','POST',{ref:`refs/heads/${branch}`,sha:release});
if(!journal){
  if(stored){
    const previous=JSON.parse(Buffer.from(stored.content,'base64').toString());
    // Immutable history is read back before active pointer rotation.
    persistGroup2Journal(api,`contents/archive/${digest(previous.binding)}.json`,branch,null,previous,'all-group archive');
  }
  journal={binding,complete:false,published:false,keys,steps:observations.map(s=>({...s,oldHash:s.moduleHash,phase:'ready'}))};
}
validateJournal(journal,binding);
const persist=async()=>{stored=persistGroup2Journal(api,path,branch,stored,journal,'all-groups');saveReport('progress.json',journal);};
const verifyKeys=async()=>{for(const k of journal.keys)keyGate(k.groupId,'after');};
if(recovery){
  await verifyCompletedRecovery(journal,{gate,observe,verifyKeys});
  journal.recovery=recovery.recovery;
}
await persist();await verifyKeys();
if(settingsRelease) {
  // Motoko release switches are transient upgrade-time reads. Settings are
  // retained first; only the ordered verified module upgrades activate them.
  // Identity and all PII receivers precede every club trigger.
  journal.cleanupActivation??=cleanupPlan.map((s:any)=>({...s,phase:'ready'}));
  if(journal.cleanupActivation.length!==targets.length || cleanupPlan.some((p:any)=>journal.cleanupActivation.filter((s:any)=>Object.keys(p).every(k=>s[k]===p[k])&&['ready','pending','complete'].includes(s.phase)).length!==1))throw Error('Foreign cleanup activation journal');
  await persist();
  if(recovery && journal.cleanupActivation.some((s:any)=>s.phase!=='complete'))throw Error('Recovery cannot activate settings');
  await activateCleanupSettings(journal.cleanupActivation,{gate,observe,persist,update:async(t:Target)=>{
    const cid=Principal.fromText(t.canisterId);
    const mgmt=Actor.createActor(mgmtIdl,{agent,canisterId:'aaaaa-aa',effectiveCanisterId:cid} as Parameters<typeof Actor.createActor>[1]) as unknown as {canister_status(a:{canister_id:Principal}):Promise<any>};
    const s=await mgmt.canister_status({canister_id:cid});
    // Never serialize or print environment values, which may contain secrets.
    const factory=()=>IDL.Service({update_settings:IDL.Func([IDL.Record({canister_id:IDL.Principal,settings:IDL.Record({environment_variables:IDL.Opt(IDL.Vec(IDL.Record({name:IDL.Text,value:IDL.Text})))})})],[],[])});
    const writer=Actor.createActor(factory,{agent,canisterId:'aaaaa-aa',effectiveCanisterId:cid} as Parameters<typeof Actor.createActor>[1]) as unknown as {update_settings(a:unknown):Promise<void>};
    await writer.update_settings({canister_id:cid,settings:{environment_variables:[releaseEnvironment(s.settings.environment_variables,t.name)]}});
  }});
}
// Installation completion is not release completion; backfill/snapshot must also pass.
const moduleJournal={...journal,complete:false};
if(!recovery)await executeUpgrades(moduleJournal,{upgradeUnchanged:scope==='full_backend'||settingsRelease,gate,observe,persist:async()=>{journal.modulesComplete=moduleJournal.complete;await persist();},verifyKeys,install:async(t:Target)=>{
  if(recovery)throw Error('Recovery cannot install any module');
  // Each club's trigger is upgraded only after identity and all PII receivers.
  // Settings are protected/read back above and sampled again by executeUpgrades.
  const r=spawnSync('icp',installArgs(t,resolve(artifacts,t.name)),{cwd:directory,stdio:'inherit'});
  if(r.status!==0)throw Error('Install reply failed/unknown; pending journal retained, no replay');
}});
// Gallery authority wiring is governor-set canister state that migrations
// initialise to null; re-apply it idempotently after every module upgrade so
// gallery notifications and Vault copy authority keep working on every group.
for(const t of targets.filter(t=>t.name==='media_metadata')){
  const {club,vault}=galleryAuthorities(inventory,t,provisions);
  const factory=()=>IDL.Service({set_gallery_authorities:IDL.Func([IDL.Principal,IDL.Principal],[IDL.Variant({Ok:IDL.Null,Err:IDL.Text})],[])});
  const actor=Actor.createActor(factory,{agent,canisterId:t.canisterId}) as unknown as {set_gallery_authorities(c:Principal,v:Principal):Promise<{Ok:null}|{Err:string}>};
  await gate();
  // This setter atomically assigns the same exact pair; repeating it is idempotent.
  journal.galleryAuthorities??={};
  journal.galleryAuthorities[t.canisterId]={club,vault,phase:'pending'};await persist();
  const r=await actor.set_gallery_authorities(Principal.fromText(club),Principal.fromText(vault));
  if('Err'in r)throw Error(`Gallery authority wiring refused for ${t.groupId}: ${r.Err}`);
  journal.galleryAuthorities[t.canisterId]={club,vault,phase:'complete'};await persist();
}
// Owner-approved one-time display link of the original Group 1 club service.
// Set-once and idempotent on the canister; read back before continuing.
for(const t of displayLinks){
  const factory=()=>IDL.Service({link_display_identity_authority:IDL.Func([IDL.Principal],[IDL.Variant({Ok:IDL.Null,Err:IDL.Text})],[])});
  const actor=Actor.createActor(factory,{agent,canisterId:t.canisterId}) as unknown as {link_display_identity_authority(p:Principal):Promise<{Ok:null}|{Err:string}>};
  await gate();
  journal.displayIdentityLinks??={};
  const saved=journal.displayIdentityLinks[t.canisterId];
  if(saved?.phase==='complete')continue;
  if(saved)throw Error('Unknown display link; retain intent and reconcile without replay');
  journal.displayIdentityLinks[t.canisterId]={beforeHash:wiring[t.canisterId],afterHash:digest(displayLinkRows[t.canisterId]),phase:'pending'};
  await persist();
  const r=await actor.link_display_identity_authority(Principal.fromText(shared.identity_access));
  if('Err'in r)throw Error(`Display identity link refused for ${t.groupId}: ${r.Err}`);
  const rows=await readConfig(t);
  if(digest(rows)!==journal.displayIdentityLinks[t.canisterId].afterHash)throw Error('Display identity link readback failed; retain intent');
  journal.displayIdentityLinks[t.canisterId].phase='complete';await persist();
  console.log(`Linked ${t.groupId} club service to the account service for private name displays.`);
}
// Shared-key audiences need each club service to know its group's private-
// details service. Idempotent: set only when empty, stop on any mismatch.
for(const t of targets.filter(t=>t.name==='club_domain')){
  const expected=inventory.pii[t.groupId];
  if(!expected)throw Error(`No private-details service recorded for ${t.groupId}`);
  const factory=()=>IDL.Service({pii_canister_status:IDL.Func([],[IDL.Opt(IDL.Principal)],['query']),set_pii_canister:IDL.Func([IDL.Principal],[IDL.Variant({Ok:IDL.Null,Err:IDL.Text})],[])});
  const actor=Actor.createActor(factory,{agent,canisterId:t.canisterId}) as unknown as {pii_canister_status():Promise<[]|[Principal]>;set_pii_canister(p:Principal):Promise<{Ok:null}|{Err:string}>};
  const current=(await actor.pii_canister_status())[0]?.toText();
  if(current===expected){console.log(`${t.groupId} club service private-details link confirmed.`);continue;}
  if(current)throw Error(`${t.groupId} club service points at ${current}, expected ${expected}; not changed`);
  await gate();
  const r=await actor.set_pii_canister(Principal.fromText(expected));
  if('Err'in r)throw Error(`Private-details link refused for ${t.groupId}: ${r.Err}`);
  if((await actor.pii_canister_status())[0]?.toText()!==expected)throw Error(`Private-details link readback failed for ${t.groupId}`);
  console.log(`Set ${t.groupId} club service private-details link.`);
}
if(journal.publication || journal.published){validateJournal(journal,binding);console.log('Exact saved snapshot retained for publication resume; modules reverified without reinstall.');process.exit(0);}
// Metadata's ordered page index is a required, idempotent release prerequisite.
for(const t of targets.filter(t=>t.name==='media_metadata')){
  const factory=()=>IDL.Service({build_asset_page_index:IDL.Func([],[IDL.Variant({Ok:IDL.Record({scanned:IDL.Nat,complete:IDL.Bool}),Err:IDL.Text})],[])});
  const actor=Actor.createActor(factory,{agent,canisterId:t.canisterId}) as unknown as {build_asset_page_index():Promise<{Ok:{scanned:bigint;complete:boolean}}|{Err:string}>};
  let done=false;
  for(let page=0;page<10000;page++){await gate();const r=await actor.build_asset_page_index();if('Err'in r)throw Error(r.Err);if(r.Ok.complete){const settled=await actor.build_asset_page_index();if('Err'in settled||!settled.Ok.complete||settled.Ok.scanned!==0n)throw Error('Index not settled');done=true;break;}}
  if(!done)throw Error('Index backfill bound exceeded; no release publication');
}
await verifyKeys();await gate();
for(const folder of groupFolders){
  const filename=new URL(`${folder.name}/general-opening.json`,groupRoot);
  if(!existsSync(filename))continue;
  const approval=JSON.parse(readFileSync(filename,'utf8'));
  for(const s of approval.services??[]){const t=targets.find(t=>t.groupId===folder.name&&t.name===s.name);if(t){if(s.canisterId!==t.canisterId)throw Error('Approval inventory changed');s.moduleHash=t.newHash;}}
  writeFileSync(filename,JSON.stringify(approval,null,2)+'\n');
}
const snapshot=spawnSync('npx',['--yes','tsx@4',new URL('produce-routing-gates.ts',import.meta.url).pathname,resolve(pem),join(directory,'routing-gates.json')],{env:{...process.env,RECORD_ROUTING_APPROVAL:'0'},stdio:'inherit'});
if(snapshot.status!==0)throw Error('Modules settled; snapshot verification failed. Resume same release, do not repeat installs.');
await gate();for(const t of targets){const s=journal.steps.find((s:Target)=>s.canisterId===t.canisterId);const r=await observe(t);if(!s||r.moduleHash!==t.newHash||r.settingsHash!==s.settingsHash)throw Error('Post-snapshot drift');}
const paths=['frontend/src/live/generated/routingGates.ts',...groupFolders.filter(folder=>existsSync(new URL(`${folder.name}/general-opening.json`,groupRoot))).map(folder=>`deploy/groups/${folder.name}/general-opening.json`)];
if(scope==='full_backend'){
  const manifestPath='deploy/mainnet/backend-release.json';
  writeFileSync(new URL(manifestPath,root),JSON.stringify({sourceRevision:release,planHash,groups:inventory.groups.map((g:{id:string})=>g.id),targets,liveAcceptance:false},null,2)+'\n');
  paths.push(manifestPath);
}
journal.snapshotFiles=paths.sort().map(path=>({path,content:readFileSync(new URL(path,root),'utf8')}));
journal.snapshotFilesHash=digest(journal.snapshotFiles);
journal.snapshotVerified=true;journal.complete=true;validateJournal(journal,binding);await persist();
console.log('Every selected module verified. Publish saved fingerprints through the workflow; app release and signed-in acceptance remain separate.');