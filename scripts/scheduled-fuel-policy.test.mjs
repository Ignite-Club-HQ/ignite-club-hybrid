import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFuel, executeFuel } from './scheduled-fuel-policy.mjs';
const readings = [{ id: 'a', cycles: '5' }, { id: 'b', cycles: '10' }];
const opts = { readings, threshold: '10', target: '30', fee: '2', balance: '100', ceiling: '100' };
test('default plan only and exact threshold', () => {
  const p = planFuel({ ...opts, ceiling: undefined });
  assert.equal(p.allowed, false); assert.equal(p.total, '27'); assert.equal(p.topups.length, 1);
});
test('monthly ceiling includes fees and reservations; balance fails closed', () => {
  assert.equal(planFuel({ ...opts, spent: '73' }).allowed, true);
  assert.equal(planFuel({ ...opts, spent: '74' }).allowed, false);
  assert.equal(planFuel({ ...opts, balance: '26' }).allowed, false);
});
test('invalid and duplicate evidence rejected', () => {
  for (const cycles of ['-1', 'NaN', '1.5', undefined]) assert.throws(() => planFuel({ ...opts, readings: [{ id: 'a', cycles }] }));
  assert.throws(() => planFuel({ ...opts, readings: [readings[0], readings[0]] }));
});
test('intent saved before transfer and unknown outcome never replays', async () => {
  const state = { phase: 'planned' }, events = [];
  const args = { plan: planFuel(opts), state, save: async s => events.push(s.phase), transfer: async () => { events.push('transfer'); throw Error('lost reply'); } };
  await assert.rejects(executeFuel(args));
  assert.deepEqual(events, ['deposit-intent', 'deposit-intent', 'transfer']);
  await assert.rejects(executeFuel(args)); assert.equal(state.reserved, '27');
});
test('save failure prevents transfer; completed run refuses replay', async () => {
  let calls = 0;
  await assert.rejects(executeFuel({ plan: planFuel(opts), state: { phase: 'planned' }, save: async () => { throw Error('disk'); }, transfer: async () => calls++ }));
  assert.equal(calls, 0);
  const state = { phase: 'planned' };
  const args = { plan: planFuel(opts), state, save: async () => {}, transfer: async () => calls++ };
  await executeFuel(args); assert.equal(calls, 1); await assert.rejects(executeFuel(args));
});
