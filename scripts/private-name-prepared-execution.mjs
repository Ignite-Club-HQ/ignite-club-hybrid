// Injected local execution adapter, NOT a production runner. Real transport,
// approval authentication, exclusive authority fencing and durable journals
// remain independent prerequisites. No CLI, credentials or network bootstrap.
import { createHash } from 'node:crypto';
import { canonical } from './migrate-club-plan.mjs';
import { assertNamesApproval, nameReference, withConversionWindow } from './convert-private-names.mjs';
import { verifyPrivateNameArtifact, reconcilePrivateNameRecovery } from './private-name-plan-artifact.mjs';

const hashBytes = bytes => createHash('sha256').update(Uint8Array.from(bytes)).digest('hex');
const equalBytes = (a,b) => Array.isArray(a) && canonical(a) === canonical(b);

export function validatePreparedJournal(body, planHash, journal) {
  const expected = new Map();
  for (const row of body.rows) {
    expected.set(`original:${row.accountId}`, {planHash,sink:row.sink,subject:row.subject,club:null,hash:hashBytes(row.ciphertext),ciphertext:row.ciphertext});
    for (const club of row.clubs) expected.set(`club:${row.accountId}:${club.id}`,{planHash,sink:row.sink,subject:row.subject,club:club.id,hash:hashBytes(club.ciphertext),ciphertext:club.ciphertext});
    expected.set(`profile:${row.accountId}`,{planHash,sink:row.sink,subject:row.subject,reference:nameReference(row.sink,row.subject)});
  }
  for (const id of journal.ids()) {
    const binding=expected.get(id), entry=journal.get(id);
    if (!binding || !entry || !['unknown','acknowledged','verified'].includes(entry.phase) || Object.keys(entry).sort().join(',') !== [...Object.keys(binding),'phase'].sort().join(',')) throw Error('Prepared journal inventory or phase changed');
    for (const key of Object.keys(binding)) if (canonical(entry[key]) !== canonical(binding[key])) throw Error('Prepared journal binding changed');
  }
}

/** Saved-byte execution. Unknown writes are resolved only by exact readback;
 * absence/mismatch/refusal stops without issuing the original write again. */
export async function executePreparedNameRow(row, planHash, {journal, pii, identity, guard}) {
  const reference=nameReference(row.sink,row.subject);
  const perform=async(id,binding,read,write,verify)=>{
    const prior=journal.get(id);
    if (prior) {
      if (!['unknown','acknowledged','verified'].includes(prior.phase)) throw Error('Unknown prepared journal phase');
      for (const key of Object.keys(binding)) if (canonical(prior[key]) !== canonical(binding[key])) throw Error('Prepared journal binding changed');
    } else {
      // Durable put must complete/read back before the single external write.
      await guard();
      journal.put(id,{...binding,phase:'unknown'});
      if (canonical(journal.get(id)) !== canonical({...binding,phase:'unknown'})) throw Error('Prepared intent readback mismatch');
      await guard(); await write(); await guard();
      journal.put(id,{...binding,phase:'acknowledged'});
    }
    await guard(); const stored=await read(); await guard();
    if (!verify(stored)) throw Error('Prepared write outcome unresolved or ciphertext mismatch; no replay');
    journal.put(id,{...binding,phase:'verified'});
  };
  const originalBinding={planHash,sink:row.sink,subject:row.subject,club:null,hash:hashBytes(row.ciphertext),ciphertext:row.ciphertext};
  await perform(`original:${row.accountId}`,originalBinding,()=>pii.readOriginal(row.subject),()=>pii.writeOriginal(row.subject,[...row.ciphertext]),stored=>stored?.subject===row.subject && stored?.field==='display_name' && equalBytes(stored.ciphertext,row.ciphertext));
  for (const club of row.clubs) {
    const binding={planHash,sink:row.sink,subject:row.subject,club:club.id,hash:hashBytes(club.ciphertext),ciphertext:club.ciphertext};
    await perform(`club:${row.accountId}:${club.id}`,binding,()=>pii.readClub(row.subject,club.id),()=>pii.writeClub(row.subject,club.id,[...club.ciphertext]),stored=>stored?.subject===row.subject && stored?.club===club.id && stored?.master_key_id===`vetkey-club-names-v1:${club.id}` && equalBytes(stored.ciphertext,club.ciphertext));
  }
  await perform(`profile:${row.accountId}`,{planHash,sink:row.sink,subject:row.subject,reference},()=>identity.readProfile(row.accountId),()=>identity.publishReference(row.accountId,reference),profile=>profile?.account_id===row.accountId && profile?.display_name===reference && profile?.principals?.includes(row.subject));
  return reference;
}

/** Whole-plan preflight before any mutation and again before closing/release.
 * guard authenticates owner approval, original operation and continuously held
 * exclusive authority coverage, not merely a point-in-time true assertion. */
export async function executePreparedPrivateNamePlan({artifact,expectedHash,approval},deps) {
  const body=verifyPrivateNameArtifact(artifact,expectedHash);
  approval=structuredClone(approval);
  assertNamesApproval(approval,expectedHash);
  if (typeof deps.assertExecution !== 'function' || !deps.journal || !deps.piiBySink || !deps.coordinator || !deps.executionLock) throw Error('Verified prepared execution dependencies required');
  const operationId=`club-name-conversion-${expectedHash}`;
  const context={planHash:expectedHash,operationId,identityId:body.identityId,operator:body.operator,deploymentHash:body.deploymentHash,inventoryHash:body.inventoryHash,historyRevision:body.historyRevision,sinks:structuredClone(body.sinks),approval};
  const guard=async()=>{
    if (await deps.executionLock.assertHeld(structuredClone(context)) !== true) throw Error('Exact prepared execution lock required');
    if (await deps.assertExecution(structuredClone(context)) !== true) throw Error('Authenticated prepared execution fence/approval required');
  };
  validatePreparedJournal(body,expectedHash,deps.journal);
  for (const sink of body.sinks) if (!deps.piiBySink.has(sink.id)) throw Error('Complete original PII execution actors required');
  // enter must durably claim an exclusive operation-bound lock or verify the
  // original recovery owner. Never expiry, replacement, or an automatic reset.
  if (await deps.executionLock.enter(structuredClone(context)) !== true) throw Error('Exclusive prepared execution lock required');
  const reconcile=async()=>{
    await guard();const profiles=await deps.identity.listProfiles();await guard();
    const binding=await deps.readBinding();await guard();
    return reconcilePrivateNameRecovery(body,{profiles,binding,
      decryptName:async(row,sink)=>{await guard();const name=await deps.decryptName(structuredClone(row),structuredClone(sink));await guard();return name;},
      readCiphertext:async(row,club)=>{
        const pii=deps.piiBySink.get(row.sink);await guard();
        const record=club===null ? await pii.readOriginal(row.subject) : await pii.readClub(row.subject,club);
        await guard();
        if(record?.subject!==row.subject || (club===null ? record?.field!=='display_name' : record?.club!==club || record?.master_key_id!==`vetkey-club-names-v1:${club}`)) throw Error('Prepared ciphertext record binding changed');
        return record.ciphertext;
      }});
  };
  const settleJournal=async()=>{
    validatePreparedJournal(body,expectedHash,deps.journal);
    for(const row of body.rows){
      const pii=deps.piiBySink.get(row.sink);
      const receipts=[{id:`original:${row.accountId}`,read:()=>pii.readOriginal(row.subject),verify:r=>r?.subject===row.subject && r?.field==='display_name' && equalBytes(r.ciphertext,row.ciphertext)},
        ...row.clubs.map(club=>({id:`club:${row.accountId}:${club.id}`,read:()=>pii.readClub(row.subject,club.id),verify:r=>r?.subject===row.subject && r?.club===club.id && r?.master_key_id===`vetkey-club-names-v1:${club.id}` && equalBytes(r.ciphertext,club.ciphertext)})),
        {id:`profile:${row.accountId}`,read:()=>deps.identity.readProfile(row.accountId),verify:r=>r?.account_id===row.accountId && r?.display_name===nameReference(row.sink,row.subject) && r?.principals?.includes(row.subject)}];
      for(const receipt of receipts){
        const prior=deps.journal.get(receipt.id);if(!prior)continue;
        await guard();const stored=await receipt.read();await guard();
        if(!receipt.verify(stored))throw Error('Prepared journal settlement unresolved; no replay');
        deps.journal.put(receipt.id,{...prior,phase:'verified'});
        if(canonical(deps.journal.get(receipt.id))!==canonical({...prior,phase:'verified'}))throw Error('Prepared settlement readback mismatch');
      }
    }
  };
  await reconcile(); // refusal anywhere prevents opening a window
  const guardedCoordinator=Object.fromEntries(['begin','advance','close','read'].map(method=>[method,async(...args)=>{
    await guard();
    let requireComplete=method==='close';
    if (method==='advance') {
      const current=await deps.coordinator.read(args[0]);await guard();
      if (!['Fencing','Opening','Writing','Closing','Releasing','Done'].includes(current?.phase)) throw Error('Unknown prepared coordinator phase');
      requireComplete=['Closing','Releasing','Done'].includes(current.phase);
    }
    if (requireComplete) {
      if ((await reconcile()).length!==0) throw Error('Prepared plan incomplete before closing');
      await settleJournal();
    }
    const result=await deps.coordinator[method](...args);await guard();
    // An interrupted Closing/Releasing window must not seal/release sinks
    // while a changed or unfinished plan still has pending profile rows.
    if (method==='begin' && ['Closing','Releasing','Done'].includes(result.phase)) {
      if ((await reconcile()).length!==0) throw Error('Prepared plan incomplete; closing window retained');
      await settleJournal();
    }
    return result;
  } ]));
  const window=await withConversionWindow(guardedCoordinator,operationId,body.historyRevision,async()=>{
    const pending=await reconcile();
    validatePreparedJournal(body,expectedHash,deps.journal);
    for (const row of pending) await executePreparedNameRow(row,expectedHash,{journal:deps.journal,pii:deps.piiBySink.get(row.sink),identity:deps.identity,guard});
    if ((await reconcile()).length!==0) throw Error('Prepared plan incomplete; writer window retained');
  });
  // Resuming a Closing/Releasing/Done window still requires complete readback.
  if ((await reconcile()).length!==0) throw Error('Prepared plan incomplete after window readback');
  await settleJournal();
  await guard();
  await deps.executionLock.complete(structuredClone(context));
  return {planHash:expectedHash,operationId,converted:body.rows.length,phase:window.phase};
}