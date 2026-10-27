// Signed approval envelopes. The pinned approver key and approval-event
// authenticity must come from protected operator configuration, never this file.
// No signing key generation, credentials or network entry point here.
import {verify,createPublicKey} from 'node:crypto';
import {constants,openSync,closeSync,readSync,writeSync,fsyncSync,fstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {canonical} from './migrate-club-plan.mjs';
import {verifyPrivateNameArtifact} from './private-name-plan-artifact.mjs';
import {CONFIRM_CONVERT,CONFIRM_RECOVER} from './convert-private-names.mjs';

const MAX_APPROVAL_BYTES=16384;
const equal=(a,b)=>canonical(a)===canonical(b);
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && equal(Object.keys(v).sort(),keys.sort());
const text=v=>typeof v==='string' && /^[A-Za-z0-9_.:@-]{1,128}$/.test(v);
export function verifySavedNameApproval(envelope,{artifact,expectedHash,approver,publicKey,approvalId,action}){
  const plan=verifyPrivateNameArtifact(artifact,expectedHash);
  if(!text(approver) || !text(approvalId) || !['convert','recover'].includes(action))throw Error('Pinned original approval event required');
  if(!exact(envelope,['body','signature']) || !exact(envelope.body,['kind','approver','approvalId','action','planHash','operationId','identityId','operator','deploymentHash','inventoryHash','historyRevision','sinks','confirmation']))throw Error('Strict signed names approval required');
  const expected={kind:'private-name-signed-approval-v1',approver,approvalId,action,planHash:expectedHash,operationId:`club-name-conversion-${expectedHash}`,identityId:plan.identityId,operator:plan.operator,deploymentHash:plan.deploymentHash,inventoryHash:plan.inventoryHash,historyRevision:plan.historyRevision,sinks:plan.sinks,confirmation:action==='convert'?CONFIRM_CONVERT:CONFIRM_RECOVER};
  if(!equal(envelope.body,expected) || typeof envelope.signature!=='string' || !/^[a-f0-9]{128}$/.test(envelope.signature))throw Error('Saved approval binding changed');
  const key=createPublicKey(publicKey);
  if(key.asymmetricKeyType!=='ed25519' || !verify(null,Buffer.from(canonical(expected)),key,Buffer.from(envelope.signature,'hex')))throw Error('Pinned approver signature required');
  return {action,plan:expectedHash,approvalScope:'names',confirmation:expected.confirmation,approvalId,approver};
}

/** Signing adapter must itself authenticate an explicit human approval event.
 * Do not call preparation just because a workflow supplied a confirmation. */
export async function prepareSignedNameApproval({artifact,expectedHash,approver,approvalId,action},{signApprovedEvent,publicKey}){
  const plan=verifyPrivateNameArtifact(artifact,expectedHash);
  if(typeof signApprovedEvent!=='function' || !text(approver) || !text(approvalId) || !['convert','recover'].includes(action))throw Error('Authenticated explicit names approval required');
  const body={kind:'private-name-signed-approval-v1',approver,approvalId,action,planHash:expectedHash,operationId:`club-name-conversion-${expectedHash}`,identityId:plan.identityId,operator:plan.operator,deploymentHash:plan.deploymentHash,inventoryHash:plan.inventoryHash,historyRevision:plan.historyRevision,sinks:plan.sinks,confirmation:action==='convert'?CONFIRM_CONVERT:CONFIRM_RECOVER};
  const signature=await signApprovedEvent(structuredClone(body),Buffer.from(canonical(body)));
  const envelope={body,signature:Buffer.from(signature).toString('hex')};
  verifySavedNameApproval(envelope,{artifact,expectedHash,approver,approvalId,action,publicKey});return envelope;
}

function readBounded(fd){
  const status=fstatSync(fd);
  if(!status.isFile() || status.size>MAX_APPROVAL_BYTES || (status.mode&0o077)!==0)throw Error('Private bounded saved approval required');
  const buffer=Buffer.alloc(status.size+1);let count=0;
  while(count<buffer.length){const n=readSync(fd,buffer,count,buffer.length-count,count);if(!n)break;count+=n;}
  if(count!==status.size)throw Error('Saved approval changed during read');return buffer.subarray(0,count);
}
export function readSavedNameApproval(path,binding){
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{return verifySavedNameApproval(JSON.parse(readBounded(fd).toString('utf8')),binding);}finally{closeSync(fd);}
}
export function saveSignedNameApproval(path,envelope,binding){
  verifySavedNameApproval(envelope,binding);
  const data=Buffer.from(canonical(envelope));if(data.length>MAX_APPROVAL_BYTES)throw Error('Saved approval exceeds byte budget');
  let fd;
  try{fd=openSync(path,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){if(error.code!=='EEXIST')throw error;fd=openSync(path,constants.O_RDWR|constants.O_NOFOLLOW);}
  try{
    const existing=fstatSync(fd).size;
    if(existing===0){
      // An existing empty file may be an interrupted creation; never repair it.
      if((fstatSync(fd).nlink)!==1)throw Error('Saved approval file changed');
    }
    // Exclusive creation flag is tracked separately below to avoid rewriting
    // an existing interrupted file, even if it is empty.
  }finally{closeSync(fd);}
  return persistExclusive(path,data,envelope,binding);
}

function persistExclusive(path,data,envelope,binding){
  // saveSignedNameApproval delegates only after validation; existing content
  // must match exactly. This helper never replaces a file through rename.
  const fd=openSync(path,constants.O_RDWR|constants.O_NOFOLLOW);
  try{
    const saved=readBounded(fd);
    if(saved.length===0)throw Error('Interrupted saved approval retained; refuse overwrite');
    if(!saved.equals(data))throw Error('Different saved approval retained');
    verifySavedNameApproval(JSON.parse(saved.toString('utf8')),binding);fsyncSync(fd);
  }finally{closeSync(fd);}
  return readSavedNameApproval(path,binding);
}