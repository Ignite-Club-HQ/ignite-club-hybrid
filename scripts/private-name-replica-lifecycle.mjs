// Dormant exact-authority orchestration. No production hooks, discovery,
// authority inference, automatic retry, or authorization grants.
import {canonical} from './migrate-club-plan.mjs';
const bytes=v=>Array.isArray(v)&&v.length>0&&v.length<=4096&&v.every(b=>Number.isInteger(b)&&b>=0&&b<=255);
/** Dormant authorized removal composition. Retain each alias's removal intent
 * before sending; unknown results settle only by authoritative nonmembership.
 * The caller supplies the existing authorized removal and governor transports,
 * never browser purge grants. One exact club per operation, production gated
 * by the same external evidence as the lifecycle reconciler. */
export async function removeMemberAndReconcileNames(plan, deps) {
  plan = structuredClone(plan);
  const accounts = structuredClone(deps.accounts);
  validateRemovedAccounts(plan, accounts);
  if ([deps.assertEvidence,deps.readJournal,deps.persistJournal,deps.readMembership,deps.removeMember,deps.readState].some(fn=>typeof fn!=='function') || !plan.targets?.length || new Set(plan.targets.map(t=>t.club)).size!==1) throw Error('Exact single-club authorized removal dependencies required');
  // Reuse lifecycle validation before any membership mutation. It must not
  // enter a cleanup journal or call a transport during this validation pass.
  validateLifecyclePlan(plan, deps);
  const club=plan.targets[0].club;
  const aliases=accounts.flatMap(a=>a.principals.map(subject=>({accountId:a.accountId,subject,club})));
  const guard=async()=>{if(await deps.assertEvidence(structuredClone(plan))!==true)throw Error('Complete removal exclusion/authority evidence required');};
  await guard(); let journal=await deps.readJournal(); await guard();
  if (journal && (canonical(Object.keys(journal).sort())!==canonical(['accounts','lifecycle','plan','receipts']) || canonical(journal.plan)!==canonical(plan) || canonical(journal.accounts)!==canonical(accounts) || !Array.isArray(journal.receipts) || journal.receipts.length>aliases.length || new Set(journal.receipts.map(r=>r.index)).size!==journal.receipts.length || journal.receipts.some(r=>!r || canonical(Object.keys(r).sort())!==canonical(['index','phase']) || !Number.isInteger(r.index) || r.index<0 || r.index>=aliases.length || !['unknown','verified'].includes(r.phase)))) throw Error('Original removal journal differs');
  journal=journal??{plan,accounts,receipts:[],lifecycle:null};
  validateLifecycleJournal(plan,journal.lifecycle);
  const persist=async()=>{await deps.persistJournal(structuredClone(journal));await guard();if(canonical(await deps.readJournal())!==canonical(journal))throw Error('Durable removal intent readback required');await guard();};
  // Do not remove membership if a supplied saved replica already changed.
  // Confirmed absence is harmless; denied/foreign/newer rows fail closed.
  for (const target of plan.targets) {
    await guard();const state=await deps.readState(structuredClone(target));await guard();
    if (state!==null && (!state || state.scheme!==`vetkey-club-names-v1:${target.club}` || canonical(state.ciphertext)!==canonical(target.ciphertext))) throw Error('Replica changed; retain removal lock');
  }
  for(let index=0;index<aliases.length;index++){
    const target=aliases[index];await guard();const member=await deps.readMembership({...target});await guard();
    const prior=journal.receipts.find(r=>r.index===index);
    if(member===false){if(prior)prior.phase='verified';else journal.receipts.push({index,phase:'verified'});await persist();continue;}
    if(member!==true)throw Error('Removal membership is unverified');
    if(prior)throw Error('Removal outcome unresolved or membership restored; never replay');
    journal.receipts.push({index,phase:'unknown'});await persist();await guard();
    await deps.removeMember({...target});await guard();
    if(await deps.readMembership({...target})!==false)throw Error('Removal outcome unconfirmed or membership remains');
    await guard();journal.receipts.find(r=>r.index===index).phase='verified';await persist();
  }
  return reconcileRemovedMemberNames(plan,{...deps,accounts,
    readJournal:async()=>{const saved=await deps.readJournal();if(canonical(saved)!==canonical(journal))throw Error('Original removal journal differs');return structuredClone(saved.lifecycle);},
    persistJournal:async lifecycle=>{journal.lifecycle=structuredClone(lifecycle);await persist();},
  });
}
function validateRemovedAccounts(plan, accounts) {
  if (plan?.action !== 'purge' || !Array.isArray(accounts) || !accounts.length || accounts.length > 4096) throw Error('Verified removed-account lifecycle evidence required');
  const subjects = new Map(),ids=new Set();
  for (const account of accounts) {
    if (!account || canonical(Object.keys(account).sort())!==canonical(['accountId','principals']) || typeof account.accountId !== 'string' || !account.accountId || ids.has(account.accountId) || !Array.isArray(account.principals) || !account.principals.length || account.principals.length > 8 || new Set(account.principals).size !== account.principals.length) throw Error('Complete removed-account aliases required');
    ids.add(account.accountId);
    for (const subject of account.principals) {
      if (typeof subject !== 'string' || !subject || subjects.has(subject)) throw Error('Ambiguous removed-account aliases');
      subjects.set(subject,account);
    }
  }
  for (const target of plan.targets ?? []) if (!subjects.has(target.subject)) throw Error('Foreign removed-member lifecycle target');
  if(accounts.some(a=>!(plan.targets??[]).some(t=>a.principals.includes(t.subject))))throw Error('Removed account has no exact name target');
  return subjects;
}
/** Existing owner/governor lifecycle transport is sufficient for removal:
 * no browser rights or new service. Recheck every verified account alias at
 * the owning club before each journal/read/write boundary. A role removal
 * that leaves any membership cannot authorize cleanup. */
export async function reconcileRemovedMemberNames(plan, {accounts, readMembership, ...deps}) {
  if (plan?.action !== 'purge' || !Array.isArray(accounts) || !accounts.length || accounts.length > 4096 || typeof readMembership !== 'function' || typeof deps.assertEvidence !== 'function') throw Error('Verified removed-account lifecycle evidence required');
  accounts = structuredClone(accounts); plan = structuredClone(plan);
  const subjects = validateRemovedAccounts(plan,accounts);
  const assertEvidence = async saved => {
    if (await deps.assertEvidence(saved) !== true) return false;
    const checked = new Set();
    for (const target of plan.targets) {
      const account = subjects.get(target.subject);
      for (const alias of account.principals) {
        const key = canonical([alias,target.club]);
        if (checked.has(key)) continue;
        checked.add(key);
        if (await readMembership({accountId:account.accountId,subject:alias,club:target.club}) !== false) throw Error('Removed member still has membership or membership is unverified');
        if (await deps.assertEvidence(saved) !== true) return false;
      }
    }
    return true;
  };
  return reconcileNameReplicaLifecycle(plan, {...deps,assertEvidence});
}
function validateLifecyclePlan(plan,{assertEvidence,readJournal,persistJournal,readState,writeSavedReplica,purgeExactReplica}) {
  if(!plan || canonical(Object.keys(plan).sort())!==canonical(['action','operationId','targets']) || !['refresh','purge'].includes(plan.action) || typeof plan.operationId!=='string' || !plan.operationId || plan.operationId.length>128 || !Array.isArray(plan.targets) || !plan.targets.length || plan.targets.length>4096 || [assertEvidence,readJournal,persistJournal,readState,writeSavedReplica,purgeExactReplica].some(fn=>typeof fn!=='function'))throw Error('Exact bounded lifecycle dependencies required');
  const ids=new Set();
  for(const t of plan.targets){
    if(!t || canonical(Object.keys(t).sort())!==canonical(['sink','subject','club','ciphertext',...(plan.action==='refresh'?['originalCiphertext']:[])].sort()) || !['sink','subject','club'].every(k=>typeof t[k]==='string'&&t[k].length>0&&t[k].length<=128) || !bytes(t.ciphertext) || (plan.action==='refresh'&&!bytes(t.originalCiphertext)))throw Error('Exact original-authority lifecycle target required');
    const id=canonical([t.sink,t.subject,t.club]);if(ids.has(id))throw Error('Duplicate lifecycle target');ids.add(id);
  }
}
function validateLifecycleJournal(plan,journal){
  if(journal!==null && (canonical(Object.keys(journal).sort())!==canonical(['plan','receipts']) || canonical(journal.plan)!==canonical(plan) || !Array.isArray(journal.receipts) || journal.receipts.length>plan.targets.length))throw Error('Original lifecycle journal differs');
  if(journal && (new Set(journal.receipts.map(r=>r.index)).size!==journal.receipts.length || journal.receipts.some(r=>!r || canonical(Object.keys(r).sort())!==canonical(['index','phase']) || !Number.isInteger(r.index)||r.index<0||r.index>=plan.targets.length||!['unknown','verified'].includes(r.phase))))throw Error('Invalid retained lifecycle receipts');
}
export async function reconcileNameReplicaLifecycle(plan,{assertEvidence,readJournal,persistJournal,readState,writeSavedReplica,purgeExactReplica}) {
  validateLifecyclePlan(plan,{assertEvidence,readJournal,persistJournal,readState,writeSavedReplica,purgeExactReplica});
  plan=structuredClone(plan);
  const guard=async()=>{if(await assertEvidence(structuredClone(plan))!==true)throw Error('Complete lifecycle exclusion/authority evidence required');};
  await guard();let journal=await readJournal();await guard();
  validateLifecycleJournal(plan,journal??null);
  journal=journal??{plan,receipts:[]};
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
    if(plan.action==='purge' && (!state || state.scheme!==`vetkey-club-names-v1:${target.club}` || canonical(state.ciphertext)!==canonical(target.ciphertext)))throw Error('Replica changed; retain lifecycle lock');
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