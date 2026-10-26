import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildChatPages, CHAT_PAGE_SIZE } from './migrate-club-messaging.mjs';
import { snapshotType } from './migrate-club-writers.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Principal } = require('@icp-sdk/core/principal');
const member = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const creator = Principal.fromText('2vxsx-fae') && Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');
const now = '2026-10-26T00:00:00Z';
const claims = new Map([['u1', member]]);
const base = {
  clubId: 'c1', claims, creator,
  teams: [{ id: 't1' }],
  teamMessages: [
    { id: 'm1', team_id: 't1', author_id: 'u1', text: 'First', created_at: now, is_system_message: false },
    { id: 'm2', team_id: 't1', author_id: 'u1', text: 'Second', created_at: '2026-10-26T01:00:00Z', is_system_message: false, reply_to_id: 'm1', image_url: 'https://img/x.jpg', edited_at: '2026-10-26T02:00:00Z' },
  ],
  clubMessages: [{ id: 'm3', club_id: 'c1', author_id: 'u1', text: 'Club wide', created_at: now, is_system_message: true }],
};

test('chat pages preserve order, replies, attachments and canonical conversation ids', async () => {
  const pages = buildChatPages(base);
  assert.equal(pages.length, 1);
  const type = await snapshotType(require, new URL('./migrate-schemas/messaging_domain.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const [back] = IDL.decode([type], IDL.encode([type], [pages[0]]));
  const convIds = back.conversations.map((c) => c.id).sort();
  assert.deepEqual(convIds, ['c1', 't1']); // club chat id = club id, team chat id = team id
  const team = back.conversations.find((c) => c.id === 't1');
  assert.equal(team.next_sequence, 3n);
  const msgs = back.messages.filter((m) => m.conversation_id === 't1');
  assert.deepEqual(msgs.map((m) => m.sequence), [1n, 2n]);
  assert.equal(msgs[1].reply_to_id[0], 'm1');
  assert.equal(msgs[1].attachment[0].kind, 'image');
  assert.equal(msgs[1].edited_at_ms[0], BigInt(Date.parse('2026-10-26T02:00:00Z')));
  assert.equal(msgs[0].sender.toText(), member.toText());
  const clubMsg = back.messages.find((m) => m.conversation_id === 'c1');
  assert.equal(clubMsg.sender.toText(), creator.toText()); // system message attributed to the migration
  assert.equal(clubMsg.idempotency_key, 'migrated:m3');
});

test('paging splits messages at the page size with conversations on page zero only', () => {
  const many = Array.from({ length: CHAT_PAGE_SIZE + 10 }, (_, i) => ({
    id: `m${String(i).padStart(4, '0')}`, team_id: 't1', author_id: 'u1', text: `msg ${i}`,
    created_at: new Date(Date.parse(now) + i * 1000).toISOString(), is_system_message: false,
  }));
  const pages = buildChatPages({ ...base, teamMessages: many, clubMessages: [] });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].messages.length, CHAT_PAGE_SIZE);
  assert.equal(pages[0].conversations.length > 0, true);
  assert.deepEqual(pages[0].next, [BigInt(CHAT_PAGE_SIZE)]);
  assert.equal(pages[1].conversations.length, 0);
  assert.equal(pages[1].messages.length, 10);
  assert.deepEqual(pages[1].next, []);
});

test('polls and votes travel on page zero; foreign rows and unclaimed authors refuse', () => {
  const pages = buildChatPages({ ...base, clubMessages: [],
    polls: [{ id: 'p1', chat_id: 't1', question: 'Bring oranges?', options: ['Yes', 'No'], created_by: 'u1', closed: false, created_at: now }],
    pollVotes: [{ poll_id: 'p1', user_id: 'u1', option_index: 0 }] });
  assert.equal(pages[0].polls[0][0].question, 'Bring oranges?');
  assert.equal(pages[0].polls[0][0].creator.toText(), member.toText());
  assert.equal(pages[0].poll_votes[0][0].option_index, 0);
  assert.throws(() => buildChatPages({ ...base, polls: [{ id: 'p1', chat_id: 'other', question: 'Q', options: ['a', 'b'], created_by: 'u1', created_at: now }] }), /Foreign poll/);
  assert.throws(() => buildChatPages({ ...base, polls: [{ id: 'p1', chat_id: 't1', question: 'Q', options: ['a', 'b'], created_by: 'u1', created_at: now }], pollVotes: [{ poll_id: 'p1', user_id: 'u1', option_index: 5 }] }), /outside poll options/);
  assert.throws(() => buildChatPages({ ...base, pollVotes: [{ poll_id: 'unknown', user_id: 'u1', option_index: 0 }] }), /unknown poll/);
  assert.throws(() => buildChatPages({ ...base, teamMessages: [{ id: 'x', team_id: 'other', author_id: 'u1', text: '', created_at: now }] }), /Foreign team message/);
  assert.throws(() => buildChatPages({ ...base, clubMessages: [{ id: 'x', club_id: 'other', author_id: 'u1', text: '', created_at: now }] }), /Foreign club message/);
  assert.throws(() => buildChatPages({ ...base, teamMessages: [{ id: 'x', team_id: 't1', author_id: 'stranger', text: '', created_at: now }] }), /claim/);
});

test('deleted messages are omitted and dangling replies are cleared', () => {
  const pages = buildChatPages({ ...base, teamMessages: [
    { id: 'gone', team_id: 't1', author_id: 'u1', text: 'deleted', created_at: now, deleted_at: now },
    { id: 'keep', team_id: 't1', author_id: 'u1', text: 'kept', created_at: now, reply_to_id: 'gone' },
  ], clubMessages: [] });
  const msgs = pages[0].messages;
  assert.deepEqual(msgs.map((m) => m.id), ['keep']);
  assert.deepEqual(msgs[0].reply_to_id, []);
});

test('group and club-admin rooms keep their source ids; admin rooms carry the member participant', () => {
  const pages = buildChatPages({ ...base, clubMessages: [], teamMessages: [],
    chatGroups: [{ id: 'g1', club_id: 'c1', team_id: 't1', deleted_at: null }],
    groupMessages: [{ id: 'gm1', group_id: 'g1', author_id: 'u1', text: 'hi', created_at: now }],
    clubAdminConversations: [{ id: 'ca1', club_id: 'c1', member_user_id: 'u1' }],
    clubAdminMessages: [{ id: 'am1', conversation_id: 'ca1', author_id: 'u1', text: 'question', created_at: now }] });
  const convs = pages[0].conversations;
  assert.equal(convs.find((c) => c.id === 'g1').team_id[0], 't1');
  assert.equal(convs.find((c) => c.id === 'ca1').participants[0].toText(), member.toText());
  assert.equal(pages[0].messages.find((m) => m.id === 'gm1').conversation_id, 'g1');
  assert.throws(() => buildChatPages({ ...base, chatGroups: [{ id: 'g1', club_id: 'c1' }], groupMessages: [{ id: 'x', group_id: 'foreign', author_id: 'u1', text: '', created_at: now }] }), /Foreign group message/);
});
