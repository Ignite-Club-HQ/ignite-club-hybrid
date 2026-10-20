/** Tests for the 70% capacity alert compare logic (node --test). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAlert } from './capacity-alert.mjs';

const req = (id, sourceGroupId, percent) => ({ id, sourceGroupId, percent });

test('no alert when nothing new is queued', () => {
  const requests = [req('capacity:d1:g1', 'g1', 71)];
  const { addedCount, summary } = summarizeAlert(requests, requests);
  assert.equal(addedCount, 0);
  assert.equal(summary, '');
});

test('alerts once per newly queued request with group and percent', () => {
  const prev = [req('capacity:d1:g1', 'g1', 71)];
  const next = [...prev, req('capacity:d1:g2', 'g2', 74)];
  const { addedCount, summary } = summarizeAlert(prev, next);
  assert.equal(addedCount, 1);
  assert.match(summary, /g2 at 74%/);
  assert.match(summary, /capacity:d1:g2/);
});

test('alerts when the first request ever is queued', () => {
  const { addedCount, summary } = summarizeAlert([], [req('capacity:d1:g1', 'g1', 70)]);
  assert.equal(addedCount, 1);
  assert.match(summary, /g1 at 70%/);
});

test('an existing request being rewritten identically does not re-alert', () => {
  const prev = [req('capacity:d1:g1', 'g1', 70)];
  const next = [{ ...prev[0], percent: 70, observedAtMs: prev[0].observedAtMs + 1000 }];
  const { addedCount } = summarizeAlert(prev, next);
  assert.equal(addedCount, 0);
});

test('percent or group changes on an existing request do not re-alert', () => {
  const prev = [req('capacity:d1:g1', 'g1', 70)];
  const next = [req('capacity:d1:g1', 'g1', 72)];
  const { addedCount } = summarizeAlert(prev, next);
  assert.equal(addedCount, 0);
});
