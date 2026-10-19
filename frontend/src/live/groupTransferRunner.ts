/** Resumable transfer executor (inactive, operator tooling). Drives the
 * groupTransfer state machine through an adapter; persists after every step so
 * a crash resumes from the last durable phase. Copies opaque ciphertext pages
 * only — never decrypts; cross-engine transfers are refused (separate design). */
import { abort, cutover, fence, recordCopy, release, verify, TRANSFER_DOMAINS, type DomainDigest, type Transfer } from './groupTransfer';

export type TransferAdapter = {
  sameDeployment(from: string, to: string): Promise<boolean>;
  verifyMedia?(from: string, to: string, clubId: string): Promise<void>;
  setFence(group: string, clubId: string, fenced: boolean): Promise<void>;
  exportPage(group: string, clubId: string, domain: string, cursor: string | null): Promise<{ rows: Uint8Array[]; next: string | null }>;
  importPage(group: string, clubId: string, domain: string, rows: Uint8Array[], pageIndex: number): Promise<void>;
  digest(group: string, clubId: string, domain: string): Promise<DomainDigest>;
  readRegistryRevision(): Promise<bigint>;
  swapAssignment(clubId: string, toGroup: string, expectedRevision: bigint): Promise<void>;
  purgeSource(group: string, clubId: string): Promise<void>;
  save(t: Transfer): Promise<void>;
  /** Cleanup only after terminal state is durable; replayable after a crash. */
  cleanupTerminal?(t: Transfer): Promise<void>;
  /** Operator-only original-key authorization; after all abortable checks,
   * before assignment CAS. Failure retains fences for explicit recovery. */
  prepareCutover?(t: Transfer): Promise<void>;
  /** Durable abort and verified key restoration must precede any unlock. */
  beforeAbortUnlock?(t: Transfer): Promise<void>;
};
const MAX_PAGES = 100_000;

export async function runTransfer(start: Transfer, a: TransferAdapter): Promise<Transfer> {
  let t = start;
  const step = async (n: Transfer) => { await a.save(n); t = n; };
  if (!(await a.sameDeployment(t.fromGroup, t.toGroup))) throw new Error('Cross-deployment transfer needs a separately reviewed design');
  const unlockAbort = async () => {
    await a.beforeAbortUnlock?.(t);
    await a.setFence(t.fromGroup, t.clubId, false);
    await a.cleanupTerminal?.(t);
  };
  if (t.phase === 'aborted') { await unlockAbort(); return t; }
  if (t.phase === 'released') { await a.cleanupTerminal?.(t); return t; }
  // Resumed copies must revalidate evidence before importing anything. Keep
  // locks on failed/ambiguous media checks, outside automatic abort cleanup.
  if (['planned', 'fenced', 'copied'].includes(t.phase)) await a.verifyMedia?.(t.fromGroup, t.toGroup, t.clubId);
  try {
    if (t.phase === 'planned') { await a.setFence(t.fromGroup, t.clubId, true); await step(fence(t)); }
    if (t.phase === 'fenced') {
      for (const domain of TRANSFER_DOMAINS) {
        let cursor: string | null = null; let pageIndex = 0;
        do {
          if (++pageIndex > MAX_PAGES) throw new Error(`Export of ${domain} exceeds page budget`);
          const page = await a.exportPage(t.fromGroup, t.clubId, domain, cursor);
          if (page.next !== null && page.next === cursor) throw new Error(`Export cursor stalled in ${domain}`);
          await a.importPage(t.toGroup, t.clubId, domain, page.rows, pageIndex - 1); // idempotent per page index
          cursor = page.next;
        } while (cursor !== null);
      }
      const src = await Promise.all(TRANSFER_DOMAINS.map(d => a.digest(t.fromGroup, t.clubId, d)));
      const dst = await Promise.all(TRANSFER_DOMAINS.map(d => a.digest(t.toGroup, t.clubId, d)));
      await step(recordCopy(t, src, dst));
    }
    if (t.phase === 'copied') await step(verify(t));
  } catch (e) {
    if (['planned', 'fenced', 'copied'].includes(t.phase)) {
      await step(abort(t));
      await unlockAbort();
    }
    throw e;
  }
  if (t.phase === 'verified') {
    await a.verifyMedia?.(t.fromGroup, t.toGroup, t.clubId);
    // Re-digest the fenced source: a write that slipped past the fence after
    // verification must abort the move rather than be lost at cutover.
    const recheck = await Promise.all(TRANSFER_DOMAINS.map(d => a.digest(t.fromGroup, t.clubId, d)));
    for (const r of recheck) {
      const v = t.sourceDigests?.find(x => x.domain === r.domain);
      if (!v) throw new Error(`Missing source digest for ${r.domain}`);
      if (v.records !== r.records || v.digest !== r.digest) {
        await step(abort(t));
        await unlockAbort();
        throw new Error(`Source changed during fence in ${r.domain}; transfer must be re-planned`);
      }
    }
    const rev = await a.readRegistryRevision();
    const next = cutover(t, rev); // throws on concurrent change; club stays fenced for operator decision
    await a.prepareCutover?.(t); // intentionally outside automatic abort region
    await a.swapAssignment(t.clubId, t.toGroup, rev);
    await step(next);
  }
  if (t.phase === 'cutover') { await a.purgeSource(t.fromGroup, t.clubId); await step(release(t)); }
  if (t.phase === 'released') await a.cleanupTerminal?.(t);
  return t;
}
