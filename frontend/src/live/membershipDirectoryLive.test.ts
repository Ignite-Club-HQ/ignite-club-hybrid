import { describe, it, expect } from 'vitest';
import { MEMBERSHIP_LOOKUP_RELEASE_ENABLED, requireVerifiedDirectoryReply, readReleasedMembershipDirectory } from './membershipDirectoryLive';
import type { Reply } from '../lab/bindings/identity_access/declarations/identity_access.did';

const diagnostic = (): Reply => ({ caller: { toText: () => 'caller' } as Reply['caller'], account_version: 7n,
  generation: 1n, registry_revision: 9n, inventory_digest: new Uint8Array(32), rows: [], next: [], verified_current: false });
describe('live lookup diagnostic release boundary', () => {
  it('keeps ordinary navigation off with no canister calls', async () => {
    expect(MEMBERSHIP_LOOKUP_RELEASE_ENABLED).toBe(false);
    await expect(readReleasedMembershipDirectory()).rejects.toThrow('Stage A');
  });
  it('rejects diagnostic replies even when they are populated and identity-bound', () => {
    const reply = diagnostic();
    reply.rows = [{ club_id: 'club', group_id: 'g1', authority: reply.caller }];
    expect(() => requireVerifiedDirectoryReply(reply, 'caller')).toThrow('Stage A');
  });
  it('rejects changed callers, generations and oversized pages before using rows', () => {
    expect(() => requireVerifiedDirectoryReply(diagnostic(), 'other')).toThrow('changed');
    expect(() => requireVerifiedDirectoryReply({ ...diagnostic(), generation: 0n }, 'caller')).toThrow('changed');
    expect(() => requireVerifiedDirectoryReply({ ...diagnostic(), inventory_digest: new Uint8Array(31) }, 'caller')).toThrow('changed');
    expect(() => requireVerifiedDirectoryReply({ ...diagnostic(), rows: Array.from({ length: 101 }, () => ({ club_id: 'club', group_id: 'g1', authority: diagnostic().caller })) }, 'caller')).toThrow('changed');
  });
});