// Dormant exact-authority orchestration. No production hooks, discovery,
// authority inference, automatic retry, or authorization grants.
import {canonical} from './migrate-club-plan.mjs';
const bytes=v=>Array.isArray(v)&&v.length>0&&v.length<=4096&&v.every(b=>Number.isInteger(b)&&b>=0&&b<=255);
export async function reconcileNameReplicaLifecycle(plan,{assertEvidence,readJournal,persistJournal,readState,writeSavedReplica,purgeExactReplica}) {
  if(!plan || !['refresh','purge'].includes(plan.action) || typeof plan.operationId!=='string' || !plan.operationId || !Array.isArray(plan.targets) || !plan.targets.length || plan.targets.length>4096 || [assertEvidence,readJournal,persistJournal,readState,writeSavedReplica,purgeExactReplica].some(fn=>typeof fn!=='function'))throw Error('Exact bounded lifecycle dependencies required');
  plan=structuredClone(plan);const ids=new Set();
  for(const t of plan.targets){
    if(!t || canonical(Object.keys(t).sort())!==canonical(['sink','subject','club',...(plan.action==='refresh'?['ciphertext']:[])].sort()) || !['sink','subject','club'].every(k=>typeof t[k]==='string'&&t[k].length>0&&t[k].length<=128) || (plan.action==='refresh'&&!bytes(t.ciphertext)))throw Error('Exact original-authority lifecycle target required');
    const id=canonical([t.sink,t.subject,t.club]);if(ids.has(id))throw Error('Duplicate lifecycle target');ids.add(id);
  }
  const guard=async()=>{if(await assertEvidence(structuredClone(plan))!==true)throw Error('Complete lifecycle exclusion/authority evidence required');};
  await guard();let journal=await readJournal();await guard();
  if(journal && (canonical(journal.plan)!==canonical(plan) || !Array.isArray(journal.receipts) || journal.receipts.length>plan.targets.length))throw Error('Original lifecycle journal differs');
  journal=journal??{plan,receipts:[]};
  if(new Set(journal.receipts.map(r=>r.index)).size!==journal.receipts.length || journal.receipts.some(r=>!Number.isInteger(r.index)||r.index<0||r.index>=plan.targets.length||!['unknown','verified'].includes(r.phase)))throw Error('Invalid retained lifecycle receipts');
  const persist=async()=>{await persistJournal(structuredClone(journal));await guard();if(canonical(await readJournal())!==canonical(journal))throw Error('Durable lifecycle intent readback required');await guard();};
  const matches=(state,t)=>plan.action==='purge'?state===null:state && state.scheme===`vetkey-club-names-v1:${t.club}`&&canonical(state.ciphertext)===canonical(t.ciphertext);
  for(let index=0;index<plan.targets.length;index++){
    const target=plan.targets[index];await guard();let state=await readState(structuredClone(target));await guard();
    const prior=journal.receipts.find(r=>r.index===index);
    if(matches(state,target)){
      if(prior)prior.phase='verified';else journal.receipts.push({index,phase:'verified'});
      await persist();continue;
    }
    if(prior)throw Error('Lifecycle outcome unresolved or changed; never replay');
    if(plan.action==='refresh' && state!==null)throw Error('Conflicting replica retained; never overwrite');
    journal.receipts.push({index,phase:'unknown'});await persist();await guard();
    // A lost commit reply leaves unknown. Only exact consensus readback on
    // resume can settle it; absence never authorizes another refresh write.
    if(plan.action==='refresh')await writeSavedReplica(structuredClone(target));else await purgeExactReplica(structuredClone(target));
    await guard();state=await readState(structuredClone(target));await guard();
    if(!matches(state,target))throw Error('Lifecycle write outcome unconfirmed');
    journal.receipts.find(r=>r.index===index).phase='verified';await persist();
  }
  // Recheck the complete original-authority inventory, not only last target.
  for(const target of plan.targets){await guard();const state=await readState(structuredClone(target));await guard();if(!matches(state,target))throw Error('Whole lifecycle reconciliation failed');}
  return {completed:journal.receipts.length,action:plan.action};
}