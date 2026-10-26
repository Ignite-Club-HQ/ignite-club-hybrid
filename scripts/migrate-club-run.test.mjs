import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSteps } from './migrate-club.mjs';
import { newJournal, nextAction } from './migrate-club-plan.mjs';

const noSave = () => {};
test('loaded steps are marked done and the run moves to the next step', async () => {
  const j = await runSteps({ journal: newJournal('h'), ctx: {}, save: noSave, writers: { club: async () => ({ records: 3 }) } });
  assert.equal(j.steps.club.state, 'done');
  assert.equal(nextAction(j).step, 'children');
});

test('a lost reply is recorded as unknown and is never resent', async () => {
  let j = newJournal('h'); let calls = 0;
  const writers = { club: async () => { calls++; throw Error('network timeout'); } };
  await assert.rejects(runSteps({ journal: j, ctx: {}, save: (x) => { j = x; }, writers }));
  assert.equal(j.steps.club.state, 'unknown');
  await assert.rejects(runSteps({ journal: j, ctx: {}, save: noSave, writers }), /unknown outcome/);
  assert.equal(calls, 1);
});

test('a refusal is recorded as failed, not unknown', async () => {
  let j = newJournal('h');
  await assert.rejects(runSteps({ journal: j, ctx: {}, save: (x) => { j = x; }, writers: { club: async () => { throw Error('club_domain import refused: x'); } } }));
  assert.equal(j.steps.club.state, 'failed');
});
