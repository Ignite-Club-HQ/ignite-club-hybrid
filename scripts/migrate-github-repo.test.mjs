import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffNames, planFileCopy, parseFlags } from './migrate-github-repo.mjs';

test('diffNames splits missing, extra and shared names', () => {
  const diff = diffNames(['A', 'B', 'C'], ['B', 'D']);
  assert.deepEqual(diff.missingInTarget, ['A', 'C']);
  assert.deepEqual(diff.extraInTarget, ['D']);
  assert.deepEqual(diff.inBoth, ['B']);
});

test('diffNames handles empty source and target', () => {
  assert.deepEqual(diffNames([], []), { missingInTarget: [], extraInTarget: [], inBoth: [] });
  assert.deepEqual(diffNames(['X'], []).missingInTarget, ['X']);
});

test('planFileCopy always includes workflows and dedupes', () => {
  const plan = planFileCopy(['.github/workflows', 'scripts', 'docs/']);
  assert.deepEqual(plan, ['.github/workflows', 'scripts', 'docs']);
});

test('planFileCopy rejects unsafe paths', () => {
  assert.throws(() => planFileCopy(['../outside']), /Refusing unsafe path/);
  assert.throws(() => planFileCopy(['/absolute']), /Refusing unsafe path/);
  assert.throws(() => planFileCopy(['']), /Refusing unsafe path/);
});

test('parseFlags defaults to skip-if-exists (no overwrite)', () => {
  const flags = parseFlags(['--path', 'scripts', '--from-env', 'A,B']);
  assert.deepEqual(flags.paths, ['scripts']);
  assert.equal(flags.fromEnv, 'A,B');
  assert.equal(flags.overwrite, false);
});

test('parseFlags accepts explicit --overwrite only', () => {
  assert.equal(parseFlags(['--overwrite']).overwrite, true);
  assert.throws(() => parseFlags(['--delete-missing']), /Unknown argument/);
});
