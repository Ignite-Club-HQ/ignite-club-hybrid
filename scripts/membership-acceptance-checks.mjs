// Read-only final checks for historical lookup preparation. An unchanged
// sample is NOT an atomic freshness fence or restored-state authorization.
import { fingerprint } from './membership-source-configuration.mjs';
const MAX_REVISION = 18446744073709551615n;
const revision = value => typeof value === 'bigint' && value > 0n && value <= MAX_REVISION;
const unwrap = reply => {
  if (!reply || typeof reply !== 'object' || 'Err' in reply || !('Ok' in reply)) throw new Error(reply?.Err ?? 'Invalid acceptance readback');
  return reply.Ok;
};
export function requireCompleteFill(sources, completed) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 100 ||
      new Set(sources.map(s => s.groupId)).size !== sources.length || !completed ||
      Object.keys(completed).length !== sources.length ||
      sources.some(s => !Object.hasOwn(completed, s.groupId) || !revision(completed[s.groupId]))) {
    throw new Error('Exact complete acknowledged source revisions required');
  }
  return sources.map(s => [s.groupId, completed[s.groupId]]).sort((a, b) => a[0].localeCompare(b[0]));
}
export function requireOwnershipRevisions(sources, completed, ownership, inventoryDigest) {
  const exact = requireCompleteFill(sources, completed);
  if (!ownership || ownership.complete !== true || ownership.verified_current !== false ||
      !inventoryDigest || inventoryDigest.length !== 32 ||
      fingerprint(ownership.inventory_digest) !== fingerprint(inventoryDigest) ||
      !Array.isArray(ownership.source_revisions) ||
      fingerprint([...ownership.source_revisions].sort((a, b) => a[0].localeCompare(b[0]))) !== fingerprint(exact)) {
    throw new Error('Ownership does not match exact filled source revisions');
  }
}
/** Durable historical checkpoint validation, before any restart mutation.
 * No local checkpoint can authorize a released reader. */
export function requireHistoricalCheckpoint(journal, sources) {
  if (journal.ready === true || journal.appEnabled === true || journal.verified_current === true) throw new Error('Historical checkpoint cannot authorize app activation');
  const saved = journal.acknowledgedRevisions;
  if (saved !== undefined) {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid saved source revisions');
    for (const [id, value] of Object.entries(saved)) {
      if (!sources.some(s => s.groupId === id) || typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value) || !revision(BigInt(value)) || journal.fill?.[id] !== true) throw new Error('Invalid saved source revision or fill binding');
    }
  }
  if (journal.ownership !== undefined) {
    const completed = Object.fromEntries(Object.entries(saved ?? {}).map(([id, value]) => [id, BigInt(value)]));
    const ownership = journal.ownership;
    if (!Array.isArray(ownership.source_revisions)) throw new Error('Invalid saved ownership revisions');
    const wire = { ...ownership, source_revisions: ownership.source_revisions.map(([id, value]) => {
      if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) throw new Error('Invalid saved ownership revision');
      return [id, BigInt(value)];
    }) };
    requireOwnershipRevisions(sources, completed, wire, journal.directoryInventoryDigest);
  }
}
/** Actual identity-owned consensus operation, never an operator-supplied
 * freshness assertion. Successful checks remain separate from app release. */
export async function checkReplicaAcceptance(sources, completed, transport) {
  const expected = requireCompleteFill(sources, completed);
  await transport.gate();
  const checked = unwrap(await transport.check());
  await transport.gate();
  if (checked.snapshot_verified !== true || checked.restoration_guard_verified !== true ||
      checked.verified_current !== false || checked.app_enabled !== false ||
      !Array.isArray(checked.source_revisions) || fingerprint(checked.source_revisions) !== fingerprint(expected)) throw new Error('Replica acceptance differs from filled source inventory');
  return { snapshotVerified: true, restorationGuardVerified: true, sourceRevisions: expected.map(([id, value]) => [id, String(value)]), ready: false, appEnabled: false };
}
/** Two full status/configuration/module sweeps: catches observed changes,
 * missing sources, rollback below acknowledged revisions and late drift.
 * Status is read using existing governor-only consensus methods. */
export async function checkHistoricalAcceptance(expected, transport) {
  const { sources, completed, ownership, inventoryDigest, binding, generation, targets } = expected;
  requireOwnershipRevisions(sources, completed, ownership, inventoryDigest);
  if (!revision(generation) || !Array.isArray(targets) || !targets.length) throw new Error('Exact acceptance release binding required');
  const checkConfiguration = reply => {
    const c = unwrap(reply);
    const authorities = sources.map(s => [s.groupId, s.authority.toText()]).sort();
    if (!c.enabled || c.app_enabled !== false || c.generation !== generation ||
        fingerprint(c.binding) !== fingerprint(binding) || fingerprint(c.inventory_digest) !== fingerprint(inventoryDigest) ||
        !Array.isArray(c.sources) || fingerprint(c.sources.map(([id, authority]) => [id, authority.toText()]).sort()) !== fingerprint(authorities)) throw new Error('Acceptance configuration changed');
  };
  let previous;
  for (let sweep = 0; sweep < 2; sweep++) {
    await transport.gate();
    checkConfiguration(await transport.configuration());
    const statuses = [];
    for (const source of sources) {
      const status = unwrap(await transport.status(source));
      if (!revision(status.revision) || typeof status.acknowledged !== 'bigint' || status.acknowledged !== status.revision ||
          status.pending !== false || status.revision !== completed[source.groupId]) throw new Error(`Source ${source.groupId} is pending, restored-old or changed since fill`);
      statuses.push([source.groupId, status.revision]);
    }
    for (const target of targets) {
      const actual = await transport.observe(target);
      if (actual.moduleHash !== target.newHash || actual.settingsHash !== target.settingsHash) throw new Error('Acceptance module/settings changed');
    }
    checkConfiguration(await transport.configuration());
    await transport.gate();
    const current = fingerprint(statuses);
    if (previous !== undefined && current !== previous) throw new Error('Acceptance sources changed between sweeps');
    previous = current;
  }
  return { completeCoverage: true, sampledCurrent: true, sourceRevisions: requireCompleteFill(sources, completed).map(([id, value]) => [id, String(value)]),
    verified_current: false, ready: false, appEnabled: false,
    blockers: ['Atomic read-freshness protocol not implemented', 'Independent restored-state fence not implemented', 'Released app reader not enabled'] };
}