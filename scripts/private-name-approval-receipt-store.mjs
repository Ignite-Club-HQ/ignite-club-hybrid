// Dormant append-service contract. A transport must provide authoritative
// retained reads and server-enforced CAS/append-only admission. No Git writer,
// credentials, provisioner or delivery activation is supplied by this module.
import {createHash} from 'node:crypto';
import {canonical} from './migrate-club-plan.mjs';
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&canonical(Object.keys(v).sort())===canonical([...keys].sort());
const hex=(v,n)=>typeof v==='string'&&new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const bindingKeys=['kind','artifactHash','planHash','identityId','operator','approvalId','approverKey','targetModule','artifactCommit'];
function journalValue(j){
  if(!exact(j,['binding','phase']) || !exact(j.binding,bindingKeys) || !['unknown','verified'].includes(j.phase) || j.binding.kind!=='private-name-approval-delivery-v1')throw Error('Strict approval delivery receipt required');
  for(const k of ['artifactHash','planHash','approverKey','targetModule'])if(!hex(j.binding[k],64))throw Error('Pinned receipt binding required');
  if(!hex(j.binding.artifactCommit,40) || ['identityId','operator','approvalId'].some(k=>typeof j.binding[k]!=='string'||!j.binding[k]||j.binding[k].length>128))throw Error('Pinned receipt binding required');
  return structuredClone(j);
}
export function makeNameApprovalReceiptEvent({operationKey,storeBinding,events,journal}){
  const next=journalValue(journal),prior=verifyNameApprovalReceiptEvents({operationKey,storeBinding,events});
  if(prior && canonical(prior.binding)!==canonical(next.binding))throw Error('Original receipt binding is immutable');
  if(prior?.phase==='verified'&&next.phase!=='verified')throw Error('Receipt phase cannot regress');
  if(!prior&&next.phase!=='unknown')throw Error('Unknown intent must be retained first');
  if(prior&&canonical(prior)===canonical(next))return null;
  const payload={kind:'private-name-approval-receipt-event-v1',operationKey,storeBinding,sequence:events.length+1,previous:events.at(-1)?.hash??'0'.repeat(64),journal:next};
  return {...payload,hash:digest(payload)};
}
export function verifyNameApprovalReceiptEvents({operationKey,storeBinding,events}){
  if(!hex(operationKey,64)||!hex(storeBinding,64)||!Array.isArray(events)||events.length>2)throw Error('Bounded pinned append-only receipt stream required');
  let previous='0'.repeat(64),retained=null;
  for(let i=0;i<events.length;i++){
    const event=events[i];
    if(!exact(event,['kind','operationKey','storeBinding','sequence','previous','journal','hash']) || event.kind!=='private-name-approval-receipt-event-v1' || event.operationKey!==operationKey || event.storeBinding!==storeBinding || event.sequence!==i+1 || event.previous!==previous)throw Error('Receipt stream binding or sequence changed');
    const {hash,...payload}=event;if(!hex(hash,64)||digest(payload)!==hash)throw Error('Receipt event bytes changed');
    const j=journalValue(event.journal);
    if(i===0&&j.phase!=='unknown')throw Error('Unknown intent must be retained first');
    if(retained&&(canonical(retained.binding)!==canonical(j.binding)||retained.phase!=='unknown'||j.phase!=='verified'))throw Error('Receipt transition is immutable');
    retained=j;previous=hash;
  }
  return retained;
}
export function createNameApprovalReceiptStore({operationId,storeBinding,readStream,appendEvent,assertStore}){
  if(typeof operationId!=='string'||!operationId||operationId.length>100||!hex(storeBinding,64)||[readStream,appendEvent,assertStore].some(fn=>typeof fn!=='function'))throw Error('Verified append-only receipt transport required');
  const operationKey=createHash('sha256').update(operationId).digest('hex');
  let observed=[],poisoned=false;
  const guard=async()=>{if(await assertStore({operationKey,storeBinding})!==true)throw Error('Governed receipt storage changed');};
  const read=async()=>{
    await guard();const reply=await readStream({operationKey,storeBinding});await guard();
    if(!exact(reply,['operationKey','storeBinding','complete','events'])||reply.operationKey!==operationKey||reply.storeBinding!==storeBinding||reply.complete!==true)throw Error('Authoritative complete receipt read required');
    const events=structuredClone(reply.events);verifyNameApprovalReceiptEvents({operationKey,storeBinding,events});
    if(events.length<observed.length||observed.some((e,i)=>canonical(e)!==canonical(events[i])))throw Error('Retained receipt stream regressed');
    observed=events;return events;
  };
  return {
    readJournal:async()=>verifyNameApprovalReceiptEvents({operationKey,storeBinding,events:await read()}),
    persistJournal:async journal=>{
      if(poisoned)throw Error('Receipt append outcome unknown; reopen and reconcile without replay');
      const events=await read(),event=makeNameApprovalReceiptEvent({operationKey,storeBinding,events,journal});
      // Only the caller that atomically appended the first intent may submit.
      // An identical retained intent belongs to recovery, not a fresh writer.
      if(!event)return {created:false};
      try{
        await guard();
        // The service must enforce this predecessor atomically; client reads
        // and hashes alone cannot arbitrate competing first intents.
        const acknowledgement=await appendEvent({operationKey,storeBinding,expectedPrevious:event.previous,event:structuredClone(event)});
        await guard();
        if(!exact(acknowledgement,['hash'])||acknowledgement.hash!==event.hash)throw Error('Durable receipt append acknowledgement required');
        const retained=await read();if(canonical(retained)!==canonical([...events,event]))throw Error('Durable append readback differs');
        return {created:true};
      }catch(error){poisoned=true;throw error;}
    },
  };
}