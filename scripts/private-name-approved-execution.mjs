// Approval verification boundary; still no live bootstrap. Production callers
// must supply authenticated exclusive authority/management coverage separately.
import {readSavedNameApproval} from './private-name-saved-approval.mjs';
import {executePreparedPrivateNamePlan} from './private-name-prepared-execution.mjs';
import {canonical} from './migrate-club-plan.mjs';

export async function executeSavedApprovedNamePlan({artifact,expectedHash,approvalPath,approvalBinding},deps){
  const binding={...approvalBinding,artifact,expectedHash};
  const approval=readSavedNameApproval(approvalPath,binding);
  if(typeof deps.assertExecution!=='function')throw Error('Independent exclusive execution verification required');
  const assertExecution=deps.assertExecution;
  return executePreparedPrivateNamePlan({artifact,expectedHash,approval},{...deps,assertExecution:async context=>{
    const fresh=readSavedNameApproval(approvalPath,binding);
    if(canonical(fresh)!==canonical(approval))throw Error('Original saved approval changed');
    return assertExecution(context);
  }});
}