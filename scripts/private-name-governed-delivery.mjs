// Dormant composition only: no service provision, credential or activation.
import {deliverNameApproval,verifyAdmissionArtifact} from './private-name-approval-delivery.mjs';
import {createNameApprovalReceiptStore} from './private-name-approval-receipt-store.mjs';

export async function deliverGovernedNameApproval({artifact,binding,action},{receiptTransport,...canisterTransport}) {
  // Copy mutable input before the first await; the original signature fixes
  // the operation stream even if callers later offer a different plan.
  artifact=Buffer.from(artifact);
  binding={...binding};
  const {operationId}=verifyAdmissionArtifact(artifact,binding);
  if(!receiptTransport)throw Error('Governed approval receipt transport required');
  const store=createNameApprovalReceiptStore({...receiptTransport,operationId});
  return deliverNameApproval({artifact,binding,action},{...canisterTransport,...store});
}