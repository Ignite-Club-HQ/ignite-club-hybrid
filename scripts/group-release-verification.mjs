/** Read-only release preflight. Never opens a group or changes authority
 * settings. Reports production prerequisites from authenticated live reads;
 * local fixtures cannot issue an activation grant. */
import { recoveryBinding } from './group-removal-recovery.mjs';
export async function verifyGroupRelease(inventory, adapter, approval) {
  const binding = recoveryBinding(inventory);
  const problems = [];
  if (!approval || approval.binding !== binding || approval.approved !== true) problems.push('Exact inventory and revision approval missing');
  const current = await adapter.readAuthenticatedInventory();
  if (recoveryBinding(current) !== binding) return { ready: false, binding, problems: ['Live inventory differs from approved inventory'] };
  if (await adapter.verifyExclusiveControllerFence(inventory) !== true) problems.push('Controller attestation missing');
  for (const participant of inventory.participants) {
    try {
      const evidence = await adapter.readServiceReleaseEvidence(participant);
      if (evidence.canister !== participant.id || evidence.module !== participant.module || evidence.subnet !== participant.subnet || evidence.binding !== binding) {
        problems.push(`${participant.domain}: live service binding mismatch`); continue;
      }
      if (evidence.rehearsalEnabled !== false) problems.push(`${participant.domain}: rehearsal settings cannot authorize production`);
      if (evidence.productionProtocolVerified !== true) problems.push(`${participant.domain}: production removal protocol unreleased`);
      if (evidence.authorityMirrorVerified !== true) problems.push(`${participant.domain}: authority mirror unverified`);
      if (evidence.pendingWorkSettled !== true) problems.push(`${participant.domain}: pending work not settled`);
    } catch { problems.push(`${participant.domain}: release evidence unavailable`); }
  }
  if (await adapter.verifyIndependentHistoryRecovery(binding) !== true) problems.push('Complete anti-rollback recovery unverified');
  if (await adapter.verifyAllServiceInterruptionAcceptance(binding) !== true) problems.push('All-service interruption acceptance missing');
  if (await adapter.verifySignedInDeviceAcceptance(binding) !== true) problems.push('Signed-in browser, Android and push acceptance missing');
  if (recoveryBinding(await adapter.readAuthenticatedInventory()) !== binding) problems.push('Inventory changed during verification');
  return { ready: problems.length === 0, binding, problems, authorizesOpening: false };
}