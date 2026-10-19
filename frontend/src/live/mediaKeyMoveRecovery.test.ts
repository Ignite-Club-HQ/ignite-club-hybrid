import { describe, expect, it } from 'vitest';
import { abort, planTransfer, TRANSFER_DOMAINS, type Transfer } from './groupTransfer';
import { runTransfer, type TransferAdapter } from './groupTransferRunner';
import { mediaKeyAuthorityPreparation, mediaKeyAuthorityRestoration, type MediaKeyAuthority, type MediaKeyReceipt } from './mediaKeyAuthorityPreparation';

/** Local operator integration only: no production evidence or encrypted-move
 * authorization. Real group runner + real durable key journal composition. */
describe('move runner with original-key recovery journal', () => {
  it('recovers interrupted forward/restore responses before any source unlock, without copying again', async () => {
    const binding = { deploymentId: 'deployment', registryRevision: '7', clubId: 'club', moveId: 'move', originalPiiCanister: 'original', destinationClubCanister: 'destination' };
    let authority: MediaKeyAuthority = { authority: null, revision: 0n, moveId: '' };
    let receipt: MediaKeyReceipt | null = null;
    let durable: Transfer = planTransfer('club','a','b',7n);
    let fenced = false; let sourceOwns = true; let copies = 0; let changes = 0; let failResponse = true;
    const keys = {
      verify: async () => { if (!fenced || !sourceOwns) throw new Error('fixture proof missing'); },
      read: async () => structuredClone(authority),
      set: async (value: string | null, moveId: string, revision: bigint) => {
        if (!fenced || authority.revision !== revision) throw new Error('fixture CAS denied');
        authority = { authority: value, moveId, revision: revision + 1n }; changes++;
        if (failResponse) { failResponse = false; throw new Error('response lost'); }
        return structuredClone(authority);
      },
      load: async () => structuredClone(receipt),
      save: async (value: MediaKeyReceipt) => { receipt = structuredClone(value); },
    };
    const prepare = mediaKeyAuthorityPreparation(binding, keys);
    const restore = mediaKeyAuthorityRestoration(binding, { ...keys, verifyAbort: async () => {
      if (durable.phase !== 'aborted' || !fenced || !sourceOwns) throw new Error('abort proof missing');
    } });
    const a: TransferAdapter = {
      sameDeployment: async () => true,
      setFence: async (_g, _c, on) => {
        if (!on) {
          expect(durable.phase).toBe('aborted'); expect(receipt?.state).toBe('restored');
          expect(authority).toEqual({ authority: null, revision: 2n, moveId: 'move' });
        }
        fenced = on;
      },
      exportPage: async () => ({ rows: [new Uint8Array([1])], next: null }),
      importPage: async () => { copies++; },
      digest: async (_g,_c,domain) => ({ domain, records:1, digest:'equal' }),
      readRegistryRevision: async () => 7n,
      swapAssignment: async () => { sourceOwns = false; },
      purgeSource: async () => { throw new Error('fixture should never purge'); },
      save: async value => { durable = structuredClone(value); },
      prepareCutover: async () => { await prepare(); },
      beforeAbortUnlock: async () => { await restore(); },
    };
    await expect(runTransfer(durable, a)).rejects.toThrow('response lost');
    expect(durable.phase).toBe('verified'); expect(fenced).toBe(true); expect(sourceOwns).toBe(true);
    expect(copies).toBe(TRANSFER_DOMAINS.length); expect(changes).toBe(1);
    // Explicit operator abort persists first; the runner cannot auto-abort
    // an uncertain authority preparation or assignment change.
    durable = abort(durable); failResponse = true;
    await expect(runTransfer(durable, a)).rejects.toThrow('response lost');
    expect(fenced).toBe(true); expect(changes).toBe(2); expect(receipt?.state).toBe('restore-intent');
    await runTransfer(durable, a);
    expect(fenced).toBe(false); expect(changes).toBe(2); expect(copies).toBe(TRANSFER_DOMAINS.length);
  });
});