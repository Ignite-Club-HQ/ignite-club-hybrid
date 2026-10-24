import { describe, expect, it } from 'vitest';
import { galleryCommentFromReceipt, mergeGalleryComments } from './galleryComments';

const saved = galleryCommentFromReceipt({ id: 'saved-1', body: 'Great game',
  author: { toText: () => 'paul' }, created_at_ms: 1000n });

describe('gallery comment acknowledgement', () => {
  it('preserves a canister-acknowledged reply parent', () => {
    expect(galleryCommentFromReceipt({ id: 'reply', body: 'Thanks', author: { toText: () => 'alex' },
      created_at_ms: 1000n, reply_to_id: ['saved-1'] }).reply_to_id).toBe('saved-1');
  });
  it('displays the actual saved comment even while readback is stale', () => {
    expect(mergeGalleryComments([], [saved])).toEqual([{
      id: 'saved-1', text: 'Great game', user_id: 'paul', created_at: '1970-01-01T00:00:01.000Z',
    }]);
  });
  it('replaces the acknowledged local copy by its server ID without duplicating it', () => {
    const refreshed = { ...saved, profiles: { display_name: 'Paul' } };
    expect(mergeGalleryComments([refreshed], [saved])).toEqual([refreshed]);
  });
  it('retains identical text from another member and repeated comments with distinct IDs', () => {
    const other = { ...saved, id: 'saved-2', user_id: 'alex' };
    const repeated = { ...saved, id: 'saved-3' };
    expect(mergeGalleryComments([other], [saved, repeated]).map(c => c.id)).toEqual(['saved-2', 'saved-1', 'saved-3']);
  });
});