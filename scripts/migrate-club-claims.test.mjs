import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimLink, collectMembers, hashToken, maskEmail, sendClaimInvites } from './migrate-club-claims.mjs';

test('links keep the token in the fragment', () => {
  assert.equal(claimLink('https://app.example/', 'g2', 'ab'), 'https://app.example/claim-account?g=g2#t=ab');
});

test('emails are masked before they reach the club service', () => {
  assert.equal(maskEmail('paul@example.com'), 'p***@example.com');
  assert.equal(maskEmail('nope'), '');
});

test('members include role holders and guardians of the club’s children only', () => {
  const ids = collectMembers({
    roles: [{ user_id: 'admin' }, { user_id: 'admin' }],
    childAssignments: [{ child_id: 'k1' }],
    children: [{ id: 'k1', parent_id: 'mum' }, { id: 'k9', parent_id: 'stranger' }],
    guardians: [{ child_id: 'k1', guardian_id: 'dad' }, { child_id: 'k9', guardian_id: 'other' }],
  });
  assert.deepEqual(ids, ['admin', 'dad', 'mum']);
});

const db = (tables) => ({ all: async (t) => tables[t] ?? [] });
const base = { clubId: 'c1', group: 'g2', appUrl: 'https://app', now: 0,
  approval: { action: 'invite', approvalScope: 'auth', clubId: 'c1', groupId: 'g2', confirmation: 'SEND CLAIM EMAILS' },
  db: db({ user_roles: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }], clubs: [{ name: 'Cats' }] }),
  authEmail: async (u) => (u === 'u3' ? null : `${u}@x.com`) };

test('only hashes are registered, emails go out after the club service accepts, linked members are skipped', async () => {
  const registered = [], sent = [];
  const r = await sendClaimInvites({ ...base, claimedUsers: async () => ['u2'],
    registerPage: async (rows) => registered.push(...rows), sendEmail: async (m) => sent.push(m) });
  assert.deepEqual(r, { members: 3, alreadyLinked: 1, sent: 1, noEmail: 1, failed: 0 });
  assert.equal(registered.length, 1);
  const token = sent[0].text.match(/#t=([0-9a-f]{64})/)[1];
  assert.equal(registered[0].token_hash, hashToken(token));
  assert.ok(!JSON.stringify(registered, (_, v) => (typeof v === 'bigint' ? String(v) : v)).includes(token));
});

test('no email is sent when registration fails or its reply is lost', async () => {
  const sent = [];
  await assert.rejects(sendClaimInvites({ ...base, claimedUsers: async () => [],
    registerPage: async () => { throw Error('timeout'); }, sendEmail: async (m) => sent.push(m) }));
  assert.equal(sent.length, 0);
});

test('no claims or emails are created without separate auth approval', async () => {
  let reads = 0, registrations = 0, emails = 0;
  for (const approval of [undefined, { ...base.approval, approvalScope: 'data' }, { ...base.approval, groupId: 'g3' }, { ...base.approval, clubId: 'c2' }]) {
    await assert.rejects(sendClaimInvites({ ...base, approval,
      db: { all: async () => { reads++; return []; } }, claimedUsers: async () => [],
      registerPage: async () => { registrations++; }, sendEmail: async () => { emails++; } }));
  }
  assert.equal(reads, 0);
  assert.equal(registrations, 0);
  assert.equal(emails, 0);
});
