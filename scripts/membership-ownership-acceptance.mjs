// Driver for the generated governor-only ownership operation. No observer can
// upload a proof, and this result never grants verified-current/app release.
import { fingerprint } from './membership-source-configuration.mjs';
import { requireCompleteFill } from './membership-acceptance-checks.mjs';
export async function runOwnershipAcceptance(call, expected, { maxCalls = 10000, gate = async () => {}, persist = async () => {} } = {}) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 10000 || !expected?.sources?.length ||
      expected.sources.length > 100 || new Set(expected.sources.map(s => s.groupId)).size !== expected.sources.length ||
      !expected.inventoryDigest || expected.inventoryDigest.length !== 32) throw new Error('Exact bounded ownership acceptance input required');
  const filled = expected.completed ? fingerprint(requireCompleteFill(expected.sources, expected.completed)) : undefined;
  let revisions;
  for (let at = 0; at < maxCalls; at++) {
    await gate();
    const reply = await call();
    await gate();
    if (!reply || typeof reply !== 'object' || 'Err' in reply) throw new Error(reply?.Err ?? 'Invalid ownership acceptance reply');
    const p = reply.Ok;
    if (!p || typeof p.scanned !== 'bigint' || p.scanned < 0n || p.scanned > 100n || typeof p.clubs !== 'bigint' || p.clubs < 0n ||
        typeof p.complete !== 'boolean' || p.verified_current !== false || fingerprint(p.inventory_digest) !== fingerprint(expected.inventoryDigest) ||
        !Array.isArray(p.source_revisions) || p.source_revisions.length !== expected.sources.length ||
        new Set(p.source_revisions.map(s => s[0])).size !== expected.sources.length ||
        p.source_revisions.some(([id, revision]) => !expected.sources.some(s => s.groupId === id) || typeof revision !== 'bigint' || revision < 1n)) throw new Error('Ownership acceptance binding or bounds changed');
    const current = fingerprint([...p.source_revisions].sort((a, b) => a[0].localeCompare(b[0])));
    if (filled !== undefined && current !== filled) throw new Error('Ownership sources changed from exact filled revisions');
    if (revisions !== undefined && revisions !== current) throw new Error('Ownership sources changed; rerun from current complete sources');
    revisions = current;
    if (p.complete) { await persist(p); return { ...p, ready: false, appEnabled: false }; }
  }
  throw new Error('Ownership acceptance exceeded bounded call budget');
}