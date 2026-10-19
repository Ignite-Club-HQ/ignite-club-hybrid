import { describe, expect, it, vi } from 'vitest';
import { wireAccountGroupAuthorities } from './accountGroupAuthorities';
const groups = [{ groupId: 'a', clubDomain: 'rrkah-fqaaa-aaaaa-aaaaq-cai' }, { groupId: 'b', clubDomain: 'ryjl3-tyaaa-aaaaa-aaaba-cai' }];
const identityId = 'r7inp-6aaaa-aaaaa-aaabq-cai';
describe('complete account authority wiring', () => {
  it('wires both club groups before publishing the complete identity inventory', async () => {
    const calls: string[] = [];
    await wireAccountGroupAuthorities(groups, identityId, {
      club: id => ({ set_identity_access_canister: async p => { calls.push(`${id}:${p.toText()}`); return { Ok: null }; } }),
      identity: () => ({ set_club_authorities: async ids => { calls.push(ids.map(p => p.toText()).join(',')); return { Ok: null }; } }),
    });
    expect(calls).toEqual([`${groups[0].clubDomain}:${identityId}`, `${groups[1].clubDomain}:${identityId}`, groups.map(g => g.clubDomain).join(',')]);
  });
  it('does not publish an inventory after a club refuses wiring', async () => {
    const publish = vi.fn();
    await expect(wireAccountGroupAuthorities(groups, identityId, {
      club: () => ({ set_identity_access_canister: async () => ({ Err: 'Governor required' }) }),
      identity: () => ({ set_club_authorities: publish }),
    })).rejects.toThrow('Governor required');
    expect(publish).not.toHaveBeenCalled();
  });
  it('rejects duplicate authorities before mutation', async () => {
    const club = vi.fn();
    await expect(wireAccountGroupAuthorities([groups[0], { ...groups[0], groupId: 'b' }], identityId, { club, identity: vi.fn() })).rejects.toThrow('Duplicate');
    expect(club).not.toHaveBeenCalled();
  });
  it('refuses pending unlink when the identity authority rejects the inventory', async () => {
    await expect(wireAccountGroupAuthorities(groups, identityId, {
      club: () => ({ set_identity_access_canister: async () => ({ Ok: null }) }),
      identity: () => ({ set_club_authorities: async () => ({ Err: 'Unlink recovery pending' }) }),
    })).rejects.toThrow('Unlink recovery pending');
  });
});