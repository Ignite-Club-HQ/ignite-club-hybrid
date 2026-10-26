import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildNotificationSnapshot } from './migrate-club-notifications.mjs';
import { snapshotType } from './migrate-club-writers.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Principal } = require('@icp-sdk/core/principal');
const member = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const now = '2026-10-26T00:00:00Z';
const claims = new Map([['u1', member]]);

test('notifications import as delivered receipts and scheduled messages keep variants', async () => {
  const snap = buildNotificationSnapshot({
    clubId: 'c1', claims,
    notifications: [
      { id: 'n1', club_id: 'c1', user_id: 'u1', type: 'event_reminder', message: 'Game tomorrow', dedupe_key: 'dedupe-1', is_read: true, related_id: 'e1', created_at: now },
      { id: 'n2', club_id: 'c1', user_id: 'u1', type: 'points', message: 'You earned 10', dedupe_key: null, is_read: false, related_id: null, created_at: now },
    ],
    scheduledMessages: [{ id: 's1', club_id: 'c1', author_id: 'u1', chat_type: 'team', team_id: 't1', group_id: null,
      conversation_id: null, text: 'Training tonight', image_url: null, reply_to_id: null, scheduled_for: '2026-10-27T09:00:00Z',
      status: 'pending', sent_message_id: null, error_message: null, attempted_at: null, created_at: now, updated_at: now,
      recurrence: 'weekly', recurrence_until: '2026-12-31T00:00:00Z', recurrence_parent_id: null }],
  });
  const type = await snapshotType(require, new URL('./migrate-schemas/notification_queue.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const [back] = IDL.decode([type], IDL.encode([type], [snap]));
  assert.deepEqual(back.broadcast_proofs, []);
  assert.equal(back.items.length, 2);
  assert.equal(back.items[0].user, member.toText());
  assert.deepEqual(back.items[0].status, { Delivered: null });
  assert.equal(back.items[0].read, true);
  assert.equal(back.items[0].idempotency_key, 'dedupe-1');
  assert.equal(back.items[1].idempotency_key, 'migrated:n2'); // missing dedupe key gets a stable one
  const s = back.scheduled[0];
  assert.deepEqual(s.chat_type, { Team: null });
  assert.deepEqual(s.status, { Pending: null });
  assert.deepEqual(s.recurrence, { Weekly: null });
  assert.equal(s.author, member.toText());
  assert.equal(s.scheduled_for_ms, BigInt(Date.parse('2026-10-27T09:00:00Z')));
});

test('refuses foreign rows, unknown variants and unclaimed recipients', () => {
  assert.throws(() => buildNotificationSnapshot({ clubId: 'c1', claims, notifications: [{ id: 'n', club_id: 'other', user_id: 'u1', type: 'x', message: '', created_at: now }] }), /Foreign notification/);
  assert.throws(() => buildNotificationSnapshot({ clubId: 'c1', claims, scheduledMessages: [{ id: 's', club_id: 'c1', author_id: 'u1', chat_type: 'carrier_pigeon', status: 'pending', recurrence: 'none', text: '', scheduled_for: now, created_at: now, updated_at: now }] }), /Unsupported scheduled chat type/);
  assert.throws(() => buildNotificationSnapshot({ clubId: 'c1', claims, scheduledMessages: [{ id: 's', club_id: 'c1', author_id: 'u1', chat_type: 'club', status: 'pending', recurrence: 'hourly', text: '', scheduled_for: now, created_at: now, updated_at: now }] }), /Unsupported recurrence/);
  assert.throws(() => buildNotificationSnapshot({ clubId: 'c1', claims, notifications: [{ id: 'n', club_id: 'c1', user_id: 'stranger', type: 'x', message: '', created_at: now }] }), /claim/);
});
