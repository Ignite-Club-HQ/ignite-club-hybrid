/** Fenced, resumable club transfer state machine (pure, inactive).
 * planned -> fenced -> copied -> verified -> cutover -> released.
 * Abort is allowed only before cutover and always unfences the source. */
export type TransferPhase = 'planned' | 'fenced' | 'copied' | 'verified' | 'cutover' | 'released' | 'aborted';
export type DomainDigest = { domain: string; records: number; digest: string };
export type Transfer = {
  clubId: string; fromGroup: string; toGroup: string; registryRevision: bigint; phase: TransferPhase;
  sourceDigests?: DomainDigest[]; targetDigests?: DomainDigest[]; log: TransferPhase[];
};
export const TRANSFER_DOMAINS = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain',
  'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs', 'secret_workload_identity'];

const next: Record<TransferPhase, TransferPhase | null> = { planned: 'fenced', fenced: 'copied', copied: 'verified', verified: 'cutover', cutover: 'released', released: null, aborted: null };

export function planTransfer(clubId: string, fromGroup: string, toGroup: string, registryRevision: bigint): Transfer {
  if (!clubId || fromGroup === toGroup) throw new Error('Invalid transfer');
  return { clubId, fromGroup, toGroup, registryRevision, phase: 'planned', log: ['planned'] };
}

function advance(t: Transfer, to: TransferPhase, patch: Partial<Transfer> = {}): Transfer {
  if (next[t.phase] !== to) throw new Error(`Illegal transfer step ${t.phase} -> ${to}`);
  return { ...t, ...patch, phase: to, log: [...t.log, to] };
}
const complete = (d: DomainDigest[]) => d.length === TRANSFER_DOMAINS.length && TRANSFER_DOMAINS.every(x => d.filter(r => r.domain === x).length === 1);

export const fence = (t: Transfer) => advance(t, 'fenced');
export function recordCopy(t: Transfer, source: DomainDigest[], target: DomainDigest[]) {
  if (!complete(source) || !complete(target)) throw new Error('Copy evidence must cover every domain exactly once');
  return advance(t, 'copied', { sourceDigests: source, targetDigests: target });
}
export function verify(t: Transfer) {
  if (t.phase !== 'copied') throw new Error(`Illegal transfer step ${t.phase} -> verified`);
  for (const s of t.sourceDigests!) {
    const d = t.targetDigests!.find(x => x.domain === s.domain)!;
    if (d.records !== s.records || d.digest !== s.digest) throw new Error(`Transfer mismatch in ${s.domain}`);
  }
  return advance(t, 'verified');
}
/** Cutover is a compare-and-swap on the registry revision: any concurrent
 * registry change invalidates the plan rather than racing it. */
export function cutover(t: Transfer, currentRevision: bigint) {
  if (currentRevision !== t.registryRevision) throw new Error('Registry changed; re-plan transfer');
  return advance(t, 'cutover', { registryRevision: currentRevision + 1n });
}
export const release = (t: Transfer) => advance(t, 'released');
export function abort(t: Transfer): Transfer {
  if (['cutover', 'released', 'aborted'].includes(t.phase)) throw new Error('Cannot abort after cutover');
  return { ...t, phase: 'aborted', log: [...t.log, 'aborted'] };
}
/** Which group serves the club in each phase: source until cutover. Writes are
 * refused while fenced through verified (reads continue from source). */
export function servingGroup(t: Transfer) {
  const target = t.phase === 'cutover' || t.phase === 'released';
  return { group: target ? t.toGroup : t.fromGroup, writable: !['fenced', 'copied', 'verified'].includes(t.phase) };
}
