import { digest, validateJournal, PINNED } from './membership-lookup-release-policy.mjs';

// This is a single observed CLI rejection, not a general pending-write retry.
export const REJECTED_RELEASE = 'd6075f8ecfe903b7759c034927a7c5b98c56acfb';
const IDENTITY_HASH = '8e7a12c109b049042ec17f083926952c11416694bf0e4784aa96aa5aed810861';
const CLUB_HASH = '533cc770a6fe19fe52fa7efc59857032999ff96f3294385f1f8892ecedb3b2bd';

export function rejectionEvidence(run, logs) {
  if (run?.head_sha !== REJECTED_RELEASE || run?.conclusion !== 'failure' ||
      run?.path !== '.github/workflows/release-membership-lookup.yml' ||
      !Number.isSafeInteger(run?.id) || run.id < 1 || typeof logs !== 'string' ||
      !logs.includes('Error: --wasm-memory-persistence only applies to Motoko canisters with enhanced orthogonal persistence (EOP). The target canister is not an EOP canister.') ||
      !logs.includes('Upgrade reply failed or unknown; pending journal retained, no automatic replay')) {
    throw new Error('Exact failed-run CLI rejection evidence required; no replay');
  }
  return { runId: run.id, release: run.head_sha, logsDigest: digest(logs), reason: 'non-eop-cli-rejection' };
}

/** Only the known first-install CLI rejection can continue. Changed artifacts,
 * any started club upgrade, configuration, or an unknown reply still stop. */
export async function recoverRejectedLookup(journal, binding, transport) {
  validateJournal(journal, journal.binding);
  const original = structuredClone(journal);
  const prior = journal.binding;
  if (prior.release !== REJECTED_RELEASE || !/^[a-f0-9]{40}$/.test(binding.release ?? '') ||
      prior.release === binding.release ||
      digest({ ...prior, release: binding.release }) !== digest(binding) ||
      journal.complete || journal.recovery || journal.configuration || journal.activation ||
      journal.acceptance || journal.replicaAcceptance || journal.ownership || journal.acknowledgedRevisions ||
      journal.steps.length !== 3 || journal.steps[0].canisterId !== PINNED.identity ||
      journal.steps[0].phase !== 'pending' || journal.steps[0].newHash !== IDENTITY_HASH ||
      journal.steps.slice(1).some(s => s.phase !== 'ready' || s.name !== 'club_domain' || s.newHash !== CLUB_HASH) ||
      Object.values(journal.fill ?? {}).some(v => v !== false)) {
    throw new Error('Recovery only supports the exact unstarted lookup release and unchanged artifacts; no reset');
  }
  const evidence = await transport.evidence();
  if (evidence.release !== REJECTED_RELEASE || evidence.reason !== 'non-eop-cli-rejection' ||
      !Number.isSafeInteger(evidence.runId) || evidence.runId < 1 || !/^[a-f0-9]{64}$/.test(evidence.logsDigest ?? '')) {
    throw new Error('Verified CLI rejection evidence missing');
  }
  const sweeps = [];
  for (let n = 0; n < 2; n++) {
    await transport.gate();
    const rows = [];
    for (const step of journal.steps) {
      const actual = await transport.observe(step);
      if (actual.moduleHash !== step.oldHash || actual.settingsHash !== step.settingsHash) {
        throw new Error('Recovery live module/settings differ; pending intent retained, no replay');
      }
      rows.push({ canisterId: step.canisterId, moduleHash: actual.moduleHash, settingsHash: actual.settingsHash });
    }
    await transport.gate();
    sweeps.push(rows);
  }
  // Keep the complete original intent as immutable history in the new receipt.
  const recovered = { ...structuredClone(journal), binding,
    recovery: { original, originalDigest: digest(original), evidence, sweeps } };
  recovered.steps[0].phase = 'ready';
  validateJournal(recovered, binding);
  await transport.persist(recovered);
  return recovered;
}