/** Mainnet delivery only: no build, signer, begin, advance, or conversion calls. */
import {readFileSync,writeFileSync} from 'node:fs';
import {Actor,HttpAgent} from '@icp-sdk/core/agent';
import {Principal} from '@icp-sdk/core/principal';
import {IDL} from '@icp-sdk/core/candid';
import {loadOperatorIdentity} from '../src/live/operatorTransport';
import {idlFactory} from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import {deliverNameApproval,verifyAdmissionArtifact} from '../../scripts/private-name-approval-delivery.mjs';
import {createHash} from 'node:crypto';
import {verifyNameApprovalGithubSetup} from '../../scripts/private-name-github-protection.mjs';

const env=process.env;
const required=(name:string)=>{const value=env[name];if(!value)throw Error(`${name} is required`);return value;};
const hex=(v:string,n:number)=>new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const repo=required('GITHUB_REPOSITORY'),token=required('GH_TOKEN');
if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error('Exact repository required');
const artifactCommit=required('APPROVAL_COMMIT'),artifactHash=required('APPROVAL_ARTIFACT_HASH'),planHash=required('PLAN_HASH');
if(!hex(artifactCommit,40)||!hex(artifactHash,64)||!hex(planHash,64))throw Error('Exact approval commit/artifact/plan hashes required');
const artifactPath=`private-name-approvals/${planHash}.json`;
const branch=required('PRIVATE_NAME_APPROVAL_RECEIPTS_BRANCH');
if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(branch) || branch.includes('..'))throw Error('Exact existing receipt branch required');
const action=required('ACTION');
if(!['deliver','reconcile'].includes(action) || required('CONFIRMATION').trim()!=='DELIVER SIGNED NAME APPROVAL ONLY')throw Error('Delivery-only confirmation required');
const identityId=Principal.fromText(required('IDENTITY_ACCESS_CANISTER')).toText();
const operator='vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
// Mapping is source-pinned and may never be overridden to an arbitrary target.
const ids=JSON.parse(readFileSync(new URL('../../deploy/mainnet/.icp/data/mappings/ic.ids.json',import.meta.url),'utf8'));
if(ids.identity_access!==identityId)throw Error('Approval destination differs from checked mainnet mapping');
const binding={artifactHash,planHash,identityId,operator,approvalId:required('APPROVAL_EVENT_ID'),approverKey:required('PRIVATE_NAME_APPROVER_PUBLIC_KEY'),targetModule:required('IDENTITY_APPROVAL_MODULE_HASH'),artifactCommit,canonicalPrincipal:(v:string)=>Principal.fromText(v).toText()};
async function github(path:string,method='GET',body?:unknown,allowMissing=false):Promise<any>{
  const response=await fetch(`https://api.github.com/repos/${repo}/${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  if(allowMissing && response.status===404)return null;
  if(!response.ok)throw Error(`Protected approval storage refused (${response.status}); no replay`);
  const text=await response.text();if(Buffer.byteLength(text)>48*1024*1024)throw Error('Protected artifact exceeds byte budget');return JSON.parse(text);
}
function content(file:any,max:number){
  if(!file || file.type!=='file' || file.encoding!=='base64' || typeof file.content!=='string' || !Number.isSafeInteger(file.size) || file.size>max)throw Error('Bounded exact committed artifact required');
  const bytes=Buffer.from(file.content,'base64');if(bytes.length!==file.size)throw Error('Committed artifact length mismatch');
  const sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');if(file.sha!==sha)throw Error('Committed artifact byte readback mismatch');return bytes;
}
const setup=await verifyNameApprovalGithubSetup({repository:repo,sourceCommit:required('PRIVATE_NAME_APPROVAL_DELIVERY_SOURCE_COMMIT'),sourceRef:required('PRIVATE_NAME_APPROVAL_DELIVERY_SOURCE_REF'),receiptBranch:branch,reviewerId:Number(required('PRIVATE_NAME_APPROVAL_REVIEWER_ID'))},{read:(path:string)=>github(path)});
if(!setup.deliveryReady)throw Error(setup.blocker); // never load a governor for unverified storage
const artifact=content(await github(`contents/${artifactPath}?ref=${artifactCommit}`),1500000);
const verifiedArtifact=verifyAdmissionArtifact(artifact,binding); // before agent or any canister operation
await github(`git/ref/heads/${branch}`); // require a pre-provisioned receipts branch
const protection=await github(`branches/${encodeURIComponent(branch)}/protection`);
if(protection.enforce_admins?.enabled!==true || protection.allow_force_pushes?.enabled!==false || protection.allow_deletions?.enabled!==false)throw Error('Receipt branch must enforce administrator protection and prohibit rewinds/deletion');
const operatorIdentity=loadOperatorIdentity(required('OPERATOR_PEM_PATH'));
if(operatorIdentity.getPrincipal().toText()!==operator)throw Error('Existing deployment governor required');
const agent=await HttpAgent.create({host:'https://icp-api.io',identity:operatorIdentity}); // platform root key only
const actor=Actor.createActor(idlFactory,{agent,canisterId:identityId}) as any;
const ok=(r:any)=>{if(!r || !('Ok'in r) || 'Err'in r)throw Error('Approval canister refused; blocker remains locked');return r.Ok;};
const management=Actor.createActor(({IDL:I})=>I.Service({canister_status:I.Func([I.Record({canister_id:I.Principal})],[I.Record({status:I.Variant({running:I.Null,stopped:I.Null,stopping:I.Null}),module_hash:I.Opt(I.Vec(I.Nat8)),settings:I.Record({controllers:I.Vec(I.Principal)})})],[])}),{agent,canisterId:'aaaaa-aa',effectiveCanisterId:identityId}) as any;
// An independent preparation ID may receive only one original delivery
// intent, even when a different signed plan/artifact is subsequently offered.
const receiptPath=`private-name-approval-delivery/${createHash('sha256').update(verifiedArtifact.operationId).digest('hex')}.json`;
let stored:any=null;
let observedHead='';
let lastCommit='';
async function readJournal(){
  const ref=await github(`git/ref/heads/${branch}`);if(!hex(ref.object?.sha??'',40))throw Error('Receipt branch readback refused');
  observedHead=ref.object.sha;
  stored=await github(`contents/${receiptPath}?ref=${ref.object.sha}`,'GET',undefined,true);
  return stored?JSON.parse(content(stored,16384).toString('utf8')):null;
}
async function persistJournal(journal:unknown){
  const bytes=Buffer.from(JSON.stringify(journal));
  const head=await github(`git/ref/heads/${branch}`);
  if(head.object?.sha!==observedHead)throw Error('Receipt branch changed; retain unknown outcome');
  const parent=await github(`git/commits/${observedHead}`);
  const blob=await github('git/blobs','POST',{content:bytes.toString('base64'),encoding:'base64'});
  const expectedBlob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(blob.sha!==expectedBlob)throw Error('Receipt blob acknowledgement differs');
  const tree=await github('git/trees','POST',{base_tree:parent.tree.sha,tree:[{path:receiptPath,mode:'100644',type:'blob',sha:blob.sha}]});
  const saved=await github('git/commits','POST',{message:'Retain signed name approval delivery receipt',tree:tree.sha,parents:[observedHead]});
  const commit=saved.sha;
  if(!hex(commit??'',40))throw Error('Delivery intent acknowledgement unknown; no replay');
  // Explicit compare + non-force fast-forward; an external branch write loses
  // this race and stops, rather than replacing its unknown delivery evidence.
  const before=await github(`git/ref/heads/${branch}`);
  if(before.object?.sha!==observedHead)throw Error('Receipt branch CAS conflict; no submission');
  const updated=await github(`git/refs/heads/${branch}`,'PATCH',{sha:commit,force:false});
  if(updated.object?.sha!==commit)throw Error('Receipt branch acknowledgement unknown; no replay');
  const readback=await github(`contents/${receiptPath}?ref=${commit}`);
  if(!content(readback,16384).equals(bytes))throw Error('Delivery intent readback mismatch; no replay');
  const retained=await github(`git/ref/heads/${branch}`);
  if(retained.object?.sha!==commit)throw Error('Receipt commit not retained; no submission');
  observedHead=commit;lastCommit=commit;
  stored=readback;
}
const request=(r:any)=>({...r,generation:String(r.generation),inventory_digest:Array.from(r.inventory_digest)});
const approvalReceipt=(r:any)=>({...r,request:request(r.request),identity:r.identity.toText(),operator:r.operator.toText(),signed_digest:Array.from(r.signed_digest)});
const wire=(a:any)=>({body:{...a.body,identity:Principal.fromText(a.body.identity),operator:Principal.fromText(a.body.operator),request:{...a.body.request,generation:BigInt(a.body.request.generation)},rows:a.body.rows.map((r:any)=>({...r,subject:Principal.fromText(r.subject),sink:Principal.fromText(r.sink)}))},signature:Array.from(Buffer.from(a.signature,'hex'))});
const report=await deliverNameApproval({artifact,binding,action},{
  readJournal,persistJournal,
  assertTarget:async()=>{
    if(lastCommit){const ref=await github(`git/ref/heads/${branch}`);if(ref.object?.sha!==lastCommit)return false;const retained=await github(`contents/${receiptPath}?ref=${lastCommit}`);if(!stored || !content(retained,16384).equals(content(stored,16384)))return false;}
    const s=await management.canister_status({canister_id:Principal.fromText(identityId)});return 'running'in s.status && s.settings.controllers.length===1 && s.settings.controllers[0].toText()===operator && Buffer.from(s.module_hash[0]??[]).toString('hex')===binding.targetModule;
  },
  readWindow:async(id:string)=>{const w=ok(await actor.read_private_name_write_window(id));return {request:request(w.request),phase:Object.keys(w.phase)[0]};},
  readApproval:async(id:string)=>{const r=ok(await actor.read_private_name_conversion_approval(id));return r.length?approvalReceipt(r[0]):null;},
  submitApproval:async(id:string,a:any)=>{ok(await actor.approve_private_name_conversion(id,wire(a)));},
});
writeFileSync(required('REPORT_PATH'),JSON.stringify(report),{mode:0o600});
console.log('Signed approval receipt verified; no conversion, opening or deployment performed.');