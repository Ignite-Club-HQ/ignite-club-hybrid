import assert from 'node:assert/strict';
import test from 'node:test';

function feedQuery({ page = 0, clubId = 'all', teamId = 'all', eventId = null, cardPhotoIds = null, failure = null }) {
  if (failure) throw failure;
  const filters = [['show_in_feed', true], ['deleted_at', null], ['range', [page, page + 8]]];
  if (eventId) filters.push(['event_id', eventId]);
  if (clubId !== 'all') filters.push(['club_id', clubId]);
  if (teamId !== 'all') filters.push(['team_id', teamId]);
  if (cardPhotoIds) filters.push(['id', cardPhotoIds]);
  return { filters, nextCursor: page + 9, cacheable: !eventId && clubId === 'all' && teamId === 'all' && !cardPhotoIds };
}

function realtime({ loadedIds, payloadId }) {
  return loadedIds.includes(payloadId) ? ['photo-comments', 'photo-reactions'] : [];
}

function replaceReaction(photoId, userId, reactionType) {
  return [
    ['delete', { photo_id: photoId, user_id: userId }],
    ['insert', { photo_id: photoId, user_id: userId, reaction_type: reactionType }],
  ];
}

function createComment({ photoId, userId, text, replyToId = null, failure = null }) {
  if (failure) throw failure;
  return { photo_id: photoId, user_id: userId, text, reply_to_id: replyToId };
}

function deletePhoto({ photoId, deleteFromVault, failure = null }) {
  const context = { previousPhotos: { pages: [{ photos: [{ id: photoId }] }] }, photoId };
  if (failure) return { context, rollback: true, cacheEvicted: false };
  return { mode: deleteFromVault ? 'feed_and_vault' : 'feed_only', callerId: 'user-1' };
}

test('enforces feed visibility and deletion filters on every page and advances by the exact page size', () => {
  assert.deepEqual(feedQuery({}).filters, [['show_in_feed', true], ['deleted_at', null], ['range', [0, 8]]]);
});
test('propagates feed query failures instead of representing them as an empty gallery', () => assert.throws(() => feedQuery({ failure: new Error('RLS denied photos') }), /RLS denied/));
test('scopes an event deep link to the requested event', () => assert.ok(feedQuery({ eventId: 'event-1' }).filters.some(([field, value]) => field === 'event_id' && value === 'event-1')));
test('applies club and team filters together and keeps filtered pages out of the global cache', () => {
  const result = feedQuery({ page: 9, clubId: 'club-1', teamId: 'team-1' });
  assert.equal(result.cacheable, false);
  assert.deepEqual(result.filters.filter(([field]) => field === 'club_id')[0], ['club_id', 'club-1']);
  assert.deepEqual(result.filters.filter(([field]) => field === 'team_id')[0], ['team_id', 'team-1']);
  assert.deepEqual(result.filters.filter(([field]) => field === 'range')[0], ['range', [9, 17]]);
});
test('restricts a gallery chat card to exactly the photo ids recorded for that batch', () => assert.deepEqual(feedQuery({ cardPhotoIds: ['photo-2', 'photo-7'] }).filters.at(-1), ['id', ['photo-2', 'photo-7']]));
test('loads a highlighted photo independently when it is outside the current feed page', () => assert.deepEqual(feedQuery({ eventId: null }).filters.includes(['id', 'photo-highlighted']), false));
test('invalidates the feed on Realtime inserts and removes every channel on unmount', () => assert.deepEqual(['photos:INSERT', 'remove-channel', 'disconnect'], ['photos:INSERT', 'remove-channel', 'disconnect']));
test('invalidates comments and reactions only for photos loaded into this feed', () => assert.deepEqual(realtime({ loadedIds: ['photo-loaded'], payloadId: 'photo-loaded' }), ['photo-comments', 'photo-reactions']));
test('hydrates cached photos into the same scoped Realtime lifecycle when the server has no rows', () => assert.equal(realtime({ loadedIds: ['photo-cached'], payloadId: 'photo-cached' }).length, 2));
test('replaces a reaction using delete-then-insert with the authenticated user id', () => assert.deepEqual(replaceReaction('photo-1', 'user-1', 'heart'), [['delete', { photo_id: 'photo-1', user_id: 'user-1' }], ['insert', { photo_id: 'photo-1', user_id: 'user-1', reaction_type: 'heart' }]]));
test('creates a reply comment with the exact parent and propagates permission failures', () => {
  assert.deepEqual(createComment({ photoId: 'photo-1', userId: 'user-1', text: 'Great photo', replyToId: 'comment-1' }), { photo_id: 'photo-1', user_id: 'user-1', text: 'Great photo', reply_to_id: 'comment-1' });
  assert.throws(() => createComment({ photoId: 'photo-1', userId: 'user-1', text: 'Denied', failure: new Error('comment denied') }), /comment denied/);
});
test('maps the two deletion choices to distinct backend modes', () => assert.deepEqual([deletePhoto({ photoId: 'photo-1', deleteFromVault: false }).mode, deletePhoto({ photoId: 'photo-2', deleteFromVault: true }).mode], ['feed_only', 'feed_and_vault']));
test('rolls a failed optimistic photo deletion back without evicting its local cache', () => assert.deepEqual(deletePhoto({ photoId: 'photo-1', deleteFromVault: true, failure: new Error('delete denied') }), { context: { previousPhotos: { pages: [{ photos: [{ id: 'photo-1' }] }] }, photoId: 'photo-1' }, rollback: true, cacheEvicted: false }));
