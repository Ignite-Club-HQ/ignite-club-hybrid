import { describe, expect, it } from 'vitest';
import { assertMediaTransferSafe, type MediaTransferInventory } from './mediaTransferSafety';
const safe: MediaTransferInventory = { clubId: 'club-a', fromGroup: 'a', toGroup: 'b', complete: true, encryptedObjects: 0, pendingUploads: 0, sharedQuotaReady: true };
describe('encrypted media move gate', () => {
  it('accepts only fully inventoried media-free settled clubs with shared quotas', () => {
    expect(() => assertMediaTransferSafe(safe, 'club-a', 'a', 'b')).not.toThrow();
  });
  it.each([
    [{ encryptedObjects: 1 }, 'Encrypted media'],
    [{ pendingUploads: 1 }, 'Unsettled uploads'],
    [{ sharedQuotaReady: false }, 'Shared media quota'],
    [{ complete: false }, 'Complete authenticated'],
    [{ clubId: 'other' }, 'Complete authenticated'],
    [{ fromGroup: 'other' }, 'Complete authenticated'],
    [{ toGroup: 'other' }, 'Complete authenticated'],
    [{ encryptedObjects: -1 }, 'Invalid media'],
    [{ pendingUploads: NaN }, 'Invalid media'],
  ])('blocks unsafe inventory %j', (patch, message) => {
    expect(() => assertMediaTransferSafe({ ...safe, ...patch }, 'club-a', 'a', 'b')).toThrow(message);
  });
});