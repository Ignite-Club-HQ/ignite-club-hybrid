import test from 'node:test';
import assert from 'node:assert/strict';
import { hashClub, scenarioResult } from '../scripts/scaling-benchmark.mjs';

test('routing is deterministic and keeps every club on exactly one shard', () => {
  const first = Array.from({ length: 100_000 }, (_, club) => hashClub(club) % 64);
  const second = Array.from({ length: 100_000 }, (_, club) => hashClub(club) % 64);
  assert.deepEqual(first, second);
  assert.equal(first.length, 100_000);
  assert.ok(first.every((shard) => shard >= 0 && shard < 64));
});

test('hot-club workload is visible and shard count does not change totals', () => {
  const scenario = { name: 'test', clubs: 100_000, activeRatio: 0.2, averageUsers: 70, messagesPerActiveClub: 50, hotClubMessages: 100_000 };
  const one = scenarioResult(scenario, 1);
  const many = scenarioResult(scenario, 64);
  assert.equal(one.totalMessageWrites, many.totalMessageWrites);
  assert.equal(one.totalFanoutDeliveries, many.totalFanoutDeliveries);
  assert.equal(many.hotClubMessageWrites, 100_000);
  assert.ok(many.workUnitsPerShard.maxToMean > 2);
});
