import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSteps } from './migrate-club.mjs';
import { newJournal, nextAction, recordIntent, recordReply, STEP_ORDER } from './migrate-club-plan.mjs';

const noSave = () => {};
const hash = 'a'.repeat(64);
const ctx = { clubId: 'c1', target: { groupId: 'g2' } };
const approval = { action: 'migrate', approvalScope: 'data', clubId: 'c1', groupId: 'g2', plan: hash, confirmation: 'MIGRATE CLUB TO CANISTERS' };
test('loaded steps are marked done and the run moves to the next step', async () => {
  const j = await runSteps({ journal: newJournal(hash), ctx, approval, save: noSave, writers: { club: async () => ({ records: 3 }) } });
  assert.equal(j.steps.club.state, 'done');
  assert.equal(nextAction(j).step, 'children');
});

test('a lost reply is recorded as unknown and is never resent', async () => {
  let j = newJournal(hash); let calls = 0;
  const writers = { club: async () => { calls++; throw Error('network timeout'); } };
  await assert.rejects(runSteps({ journal: j, ctx, approval, save: (x) => { j = x; }, writers }));
  assert.equal(j.steps.club.state, 'unknown');
  await assert.rejects(runSteps({ journal: j, ctx, approval, save: noSave, writers }), /unknown outcome/);
  assert.equal(calls, 1);
});

test('a refusal is recorded as failed, not unknown', async () => {
  let j = newJournal(hash);
  await assert.rejects(runSteps({ journal: j, ctx, approval, save: (x) => { j = x; }, writers: { club: async () => { throw Error('club_domain import refused: x'); } } }));
  assert.equal(j.steps.club.state, 'failed');
});

test('unapproved data execution invokes no writer and persists no intent', async () => {
  let calls = 0, saves = 0;
  for (const grant of [undefined, { ...approval, approvalScope: 'none' }, { ...approval, approvalScope: 'auth' }]) {
    await assert.rejects(runSteps({ journal: newJournal(hash), ctx, approval: grant, save: () => { saves++; }, writers: { club: async () => { calls++; } } }));
  }
  assert.equal(calls, 0);
  assert.equal(saves, 0);
});

test('data approval cannot be reused for another club, group or plan', async () => {
  let calls = 0;
  for (const grant of [{ ...approval, clubId: 'c2' }, { ...approval, groupId: 'g3' }, { ...approval, plan: 'b'.repeat(64) }]) {
    await assert.rejects(runSteps({ journal: newJournal(hash), ctx, approval: grant, save: noSave, writers: { club: async () => { calls++; } } }), /must match/);
  }
  assert.equal(calls, 0);
});

test('even verified data approval never invokes a sign-in routing writer', async () => {
  let journal = newJournal(hash), calls = 0;
  for (const step of STEP_ORDER.filter(s => s !== 'route')) journal = recordReply(recordIntent(journal, step, 0), step, 0, { ok: true, last: true });
  await assert.rejects(runSteps({ journal, ctx, approval, save: noSave, writers: { route: async () => { calls++; } } }), /does not authorize sign-in/);
  assert.equal(calls, 0);
  assert.equal(journal.routed, false);
});

test('member claim reads are destination-bound and occur before member writer intent', async () => {
  let journal = newJournal(hash);
  for (const step of ['club', 'children']) journal = recordReply(recordIntent(journal, step, 0), step, 0, { ok: true, last: true });
  const order = [];
  const context = { ...ctx, readClaims: async () => { order.push('claims'); return new Map(); } };
  await runSteps({ journal, ctx: context, approval, save: () => order.push('intent-or-reply'), writers: { events: async c => {
    assert.ok(c.claims instanceof Map); order.push('writer'); return { records: 0 };
  } } });
  assert.deepEqual(order, ['claims', 'intent-or-reply', 'writer', 'intent-or-reply']);
});
