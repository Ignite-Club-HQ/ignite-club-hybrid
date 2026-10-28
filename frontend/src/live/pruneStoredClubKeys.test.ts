// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadStoredClubKey, pruneStoredClubKeys, storeClubKey } from './deviceMediaCache';

const k = new Uint8Array([1, 2, 3]);
describe('removal cleanup of saved club keys', () => {
  beforeEach(() => localStorage.clear());
  it('drops keys for clubs the sign-in left and keeps current clubs and person keys', () => {
    storeClubKey('cid-1', 'me', 'private-club-name:h:clubnames:gone', k);
    storeClubKey('cid-1', 'me', 'private-club-name:h:clubnames:kept', k);
    storeClubKey('cid-1', 'me', 'gone', k);
    storeClubKey('cid-1', 'me', 'pii:display_name:me', k);
    storeClubKey('cid-1', 'other', 'gone', k);
    expect(pruneStoredClubKeys('me', ['kept'])).toBe(2);
    expect(loadStoredClubKey('cid-1', 'me', 'private-club-name:h:clubnames:gone')).toBeNull();
    expect(loadStoredClubKey('cid-1', 'me', 'gone')).toBeNull();
    expect(loadStoredClubKey('cid-1', 'me', 'private-club-name:h:clubnames:kept')).not.toBeNull();
    expect(loadStoredClubKey('cid-1', 'me', 'pii:display_name:me')).not.toBeNull();
    expect(loadStoredClubKey('cid-1', 'other', 'gone')).not.toBeNull();
  });
});
