import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSnapshot, expectedCounts, reconcileClub } from './migrate-club-reconcile.mjs';

test('countSnapshot counts each domain record set', () => {
  assert.equal(countSnapshot('club_domain', { teams: [{}], sponsors: [{}, {}], children: [{}], guardians: [], roles: [{}], account_roles: [], exclusions: [] }), 6);
  assert.equal(countSnapshot('events_domain', { events: [{}], rsvps: [{}, {}], game_results: [], game_summaries: [{}], game_player_stats: [] }), 4);
  assert.equal(countSnapshot('competition_domain', { competitions: [{}], matches: [{}], entries: [{}], divisions: [{}] }), 4);
  assert.equal(countSnapshot('messaging_domain', { conversations: [{}], messages: [{}, {}] }), 3);
  assert.equal(countSnapshot('media_metadata', { assets: [{}, {}] }), 2);
  assert.equal(countSnapshot('vault_domain', { folders: [{}], files: [{}] }), 2);
  assert.equal(countSnapshot('notification_queue', { items: [{}], scheduled: [{}] }), 2);
  assert.throws(() => countSnapshot('unknown_domain', {}), /No counter/);
});

test('expectedCounts sums journaled per-domain counts from done steps only', () => {
  const journal = { steps: {
    club: { state: 'done', counts: { club_domain: 5 } },
    children: { state: 'done', counts: { club_domain: 7, pii_access_control: 4 } },
    events: { state: 'unknown', counts: { events_domain: 99 } },
  } };
  assert.deepEqual(expectedCounts(journal), { club_domain: 12, pii_access_control: 4 });
});

test('reconcileClub passes when destination counts match the journal', async () => {
  const journal = { steps: {
    media: { state: 'done', counts: { media_metadata: 2 } },
    media_bytes: { state: 'done' },
  } };
  const report = await reconcileClub({}, journal, {
    readSnapshot: async (d) => d === 'media_metadata'
      ? { assets: [{ blob_ref: [{ canister: 's', path: 'p', content_hash: 'h' }] }, { blob_ref: [{ canister: 's', path: 'q', content_hash: 'h' }] }] }
      : { files: [] },
  });
  assert.ok(report.every((r) => r.ok));
  assert.equal(report.find((r) => r.domain === 'media_metadata').actual, 2);
});

test('reconcileClub throws on count mismatch', async () => {
  const journal = { steps: { media: { state: 'done', counts: { media_metadata: 3 } } } };
  await assert.rejects(
    reconcileClub({}, journal, { readSnapshot: async () => ({ assets: [{}] }) }),
    /Reconciliation failed for media_metadata: destination has 1, writers acknowledged 3/,
  );
});

test('reconcileClub throws when blob refs are missing after media_bytes', async () => {
  const journal = { steps: {
    vault: { state: 'done', counts: { vault_domain: 2 } },
    media_bytes: { state: 'done' },
  } };
  await assert.rejects(
    reconcileClub({}, journal, {
      readSnapshot: async () => ({ folders: [{}], files: [{ blob_ref: [] }] }),
    }),
    /vault_domain records still lack on-chain bytes/,
  );
});
