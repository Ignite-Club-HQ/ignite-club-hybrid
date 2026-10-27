// Delivery-only. Never creates a signature, window, deployment or conversion.
import {createHash,createPublicKey,verify} from 'node:crypto';
import {canonical} from './migrate-club-plan.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && canonical(Object.keys(v).sort())===canonical([...keys].sort());
const hex=(v,n)=>typeof v==='string' && new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const bytes=(v,n)=>Array.isArray(v) && v.length>0 && v.length<=n && v.every(x=>Number.isInteger(x)&&x>=0&&x<=255);
const text=(v,n)=>typeof v==='string' && v.length>0 && v.length<=n;
const nat=v=>typeof v==='string' && /^[1-9][0-9]*$/.test(v) && BigInt(v)<=18446744073709551615n;
export function admissionBytes(b){
  const chunks=[],add=v=>{const value=typeof v==='string'?Buffer.from(v):Buffer.from(v);const length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(value.length));chunks.push(length,value);};
  for(const v of [b.kind,b.approval_id,b.identity,b.operator,b.request.operation_id,b.request.generation,b.plan_hash])add(v);
  add(b.request.inventory_digest);add(String(b.rows.length));
  for(const r of b.rows){for(const v of [r.account_id,r.subject,r.sink])add(v);add(r.source_digest);add(r.ciphertext);add(String(r.clubs.length));for(const c of r.clubs){add(c.club);add(c.ciphertext);}}
  return Buffer.concat(chunks);
}
export function verifyAdmissionArtifact(raw,{artifactHash,planHash,identityId,operator,approverKey,approvalId,canonicalPrincipal}){
  if(!Buffer.isBuffer(raw) || raw.length>32*1024*1024 || !hex(artifactHash,64) || hash(raw)!==artifactHash)throw Error('Original pinned approval artifact required');
  const a=JSON.parse(raw.toString('utf8')),b=a?.body;
  if(!exact(a,['body','signature']) || !exact(b,['kind','approval_id','identity','operator','request','plan_hash','rows']) || !exact(b.request,['operation_id','generation','inventory_digest']))throw Error('Strict backend signed approval required');
  if(typeof canonicalPrincipal!=='function')throw Error('Canonical principal verifier required');
  const principal=v=>{if(!text(v,64) || ['2vxsx-fae','aaaaa-aa'].includes(v) || canonicalPrincipal(v)!==v)throw Error('Exact canonical principal required');};
  principal(identityId);principal(operator);principal(b.identity);principal(b.operator);
  if(b.kind!=='ignite-private-name-admission-v1' || b.identity!==identityId || b.operator!==operator || !hex(planHash,64) || b.plan_hash!==planHash || !text(approvalId,128) || b.approval_id!==approvalId
    || b.request.operation_id!==`names:club-name-conversion-${planHash}` || !nat(b.request.generation) || !bytes(b.request.inventory_digest,32) || b.request.inventory_digest.length!==32
    || !Array.isArray(b.rows) || !b.rows.length || b.rows.length>4096 || !hex(a.signature,128) || !hex(approverKey,64))throw Error('Exact signed approval binding required');
  const accounts=new Set(),subjects=new Set();
  for(const r of b.rows){
    if(!exact(r,['account_id','subject','sink','source_digest','ciphertext','clubs']) || !text(r.account_id,64) || accounts.has(r.account_id) || subjects.has(r.subject) || !bytes(r.source_digest,32) || r.source_digest.length!==32 || !bytes(r.ciphertext,4096) || !Array.isArray(r.clubs) || r.clubs.length>1000)throw Error('Invalid approved ciphertext row');
    principal(r.subject);principal(r.sink);accounts.add(r.account_id);subjects.add(r.subject);
    const clubs=new Set();for(const c of r.clubs){if(!exact(c,['club','ciphertext']) || !text(c.club,128) || clubs.has(c.club) || !bytes(c.ciphertext,4096))throw Error('Invalid approved club ciphertext');clubs.add(c.club);}
  }
  const signed=admissionBytes(b);
  if(signed.length>32*1024*1024)throw Error('Signed approval byte budget exceeded');
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(approverKey,'hex')]),format:'der',type:'spki'});
  if(!verify(null,signed,key,Buffer.from(a.signature,'hex')))throw Error('Original owner signature required');
  return {approval:a,operationId:`club-name-conversion-${planHash}`,receipt:{request:b.request,approval_id:b.approval_id,plan_hash:b.plan_hash,operator:b.operator,identity:b.identity,signed_digest:Array.from(createHash('sha256').update(signed).update(Buffer.from(a.signature,'hex')).digest())}};
}
export async function deliverNameApproval({artifact,binding,action},{readWindow,readApproval,submitApproval,readJournal,persistJournal,assertTarget}){
  if(!['deliver','reconcile'].includes(action))throw Error('Delivery-only action required');
  const verified=verifyAdmissionArtifact(artifact,binding),{approval,operationId,receipt}=verified;
  const immutable={kind:'private-name-approval-delivery-v1',artifactHash:binding.artifactHash,planHash:binding.planHash,identityId:binding.identityId,operator:binding.operator,approvalId:binding.approvalId,approverKey:binding.approverKey,targetModule:binding.targetModule,artifactCommit:binding.artifactCommit};
  if(!hex(immutable.targetModule,64) || !hex(immutable.artifactCommit,40))throw Error('Pinned target module and artifact commit required');
  const guard=async()=>{if(await assertTarget(immutable)!==true)throw Error('Original delivery target changed');};
  await guard();const prior=await readJournal();await guard();
  if(prior && (!exact(prior,['binding','phase']) || canonical(prior.binding)!==canonical(immutable) || !['unknown','verified'].includes(prior.phase)))throw Error('Original delivery intent differs; retain lock');
  const window=await readWindow(operationId);await guard();
  if(canonical(window.request)!==canonical(approval.body.request) || !['Fencing','Opening','Writing','Closing','Releasing','Done'].includes(window.phase))throw Error('Exact existing blocked conversion required');
  const current=await readApproval(operationId);await guard();
  if(current){
    if(canonical(current)!==canonical(receipt))throw Error('Different retained approval; no overwrite');
    await persistJournal({binding:immutable,phase:'verified'});return {operationId,approvalId:binding.approvalId,phase:'verified',submitted:false};
  }
  // Never resend a retained unknown intent, even if the canister returns None.
  if(prior || action==='reconcile')throw Error('Approval delivery unresolved; retain intent without replay');
  if(window.phase!=='Fencing')throw Error('Approval must arrive before conversion opens');
  const intent={binding:immutable,phase:'unknown'};
  await persistJournal(intent);
  if(canonical(await readJournal())!==canonical(intent))throw Error('Durable delivery intent readback required');
  await guard();await submitApproval(operationId,approval);await guard();
  const retained=await readApproval(operationId);await guard();
  if(canonical(retained)!==canonical(receipt))throw Error('Approval receipt unresolved; retain intent without replay');
  await persistJournal({binding:immutable,phase:'verified'});
  return {operationId,approvalId:binding.approvalId,phase:'verified',submitted:true};
}