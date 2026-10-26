import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { buildPointsSnapshot, buildClaimedRsvps } from './migrate-club-members.mjs';
import { snapshotType, WRITERS } from './migrate-club-writers.mjs';
import { STEPS } from './migrate-club-plan.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Principal } = require('@icp-sdk/core/principal');
const principal = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const now = '2026-10-26T00:00:00Z';
const claims = new Map([['u1', principal]]);
const input = { clubId: 'c1', claims, club: { id: 'c1', created_at: now, points_display_name: 'Stars' },
  rewards: [{ id: 'reward', club_id: 'c1', name: 'Badge', points_required: 30, is_default: false, is_active: true,
    reward_type: 'custom', show_qr_code: false, created_at: now, updated_at: now }],
  users: [{ club_id: 'c1', user_id: 'u1', points: 75, updated_at: now }],
  history: [{ id: 'h1', club_id: 'c1', user_id: 'u1', amount: -30, balance_after: 75, source_type: 'redemption',
    source_id: 'r1', description: 'Redeemed', created_at: now, created_by: 'u1', season_id: 's1' }],
  redemptions: [{ id: 'r1', club_id: 'c1', reward_id: 'reward', user_id: 'u1', points_spent: 30, status: 'fulfilled',
    verified_by: 'u1', verified_at: now, created_at: now, redeemed_at: now, idempotency_key: 'original-operation' }],
  cooldowns: [{ id: 'd1', club_id: 'c1', user_id: 'u1', action_type: 'attendance', scope_id: 'e1', awarded_date: '2026-10-26', points_awarded: 10, created_at: now }] };
const rsvp = { event_id: 'e1', user_id: 'u1', status: 'going', source: 'manual', has_paid: false, updated_at: now };

test('points preserve balances, negative history, statuses, verification and idempotency without granting roles', async () => {
  const snap = buildPointsSnapshot(input);
  const type = await snapshotType(require, new URL('./migrate-schemas/club_points_domain.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const [back] = IDL.decode([type], IDL.encode([type], [snap]));
  assert.equal(back.users[0].points, 75);
  assert.equal(back.users[0].user_id, principal.toText());
  assert.equal(back.history[0].amount, -30);
  assert.equal(back.history[0].balance_after, 75);
  assert.equal(back.redemptions[0].status, 'fulfilled');
  assert.deepEqual(back.redemptions[0].idempotency_key, ['original-operation']);
  assert.equal(back.redemptions[0].verified_by[0].toText(), principal.toText());
  assert.equal(back.cooldowns[0].points_awarded, 10);
  assert.deepEqual(back.roles, []);
});
test('unclaimed and anonymous principals cannot own imported points', () => {
  for (const map of [new Map(), new Map([['u1', Principal.anonymous()]])]) assert.throws(() => buildPointsSnapshot({ ...input, claims: map }), /claim/);
});
test('children require an explicitly verified migrated-child dependency', () => {
  const children = [{ club_id: 'c1', child_id: 'child', points: 20, updated_at: now }];
  assert.throws(() => buildPointsSnapshot({ ...input, children }), /verified migrated child/);
  assert.equal(buildPointsSnapshot({ ...input, children, migratedChildren: new Set(['child']) }).children[0].points, 20);
});
test('foreign records, duplicate balances and invalid integers are rejected, never dropped or clamped', () => {
  assert.throws(() => buildPointsSnapshot({ ...input, users: [{ ...input.users[0], club_id: 'other' }] }), /Foreign/);
  assert.throws(() => buildPointsSnapshot({ ...input, users: [...input.users, ...input.users] }), /Duplicate/);
  assert.throws(() => buildPointsSnapshot({ ...input, users: [{ ...input.users[0], points: 1.5 }] }), /points value/);
});
test('reward media is not imported as a source URL without verified destination bytes', () => {
  const rewards = [{ ...input.rewards[0], logo_url: 'source-logo' }];
  assert.throws(() => buildPointsSnapshot({ ...input, rewards }), /media reference/);
  assert.deepEqual(buildPointsSnapshot({ ...input, rewards, mediaReferences: new Map([['source-logo', 'verified-asset']]) }).rewards[0].logo_url, ['verified-asset']);
});
test('points toggles are preserved without granting subscription entitlement', () => {
  const snap = buildPointsSnapshot({ ...input, subscriptions: [{ club_id: 'c1', disable_points_system: true, disable_team_pom_rewards: true, is_pro: true, updated_at: now }] });
  assert.equal(snap.settings[0].disabled, true);
  assert.equal(snap.settings[0].disable_team_pom_rewards, true);
  assert.equal('is_pro' in snap.settings[0], false);
});
test('missing reward and ambiguous points subjects stop rather than drop history', () => {
  assert.throws(() => buildPointsSnapshot({ ...input, rewards: [] }), /redemption reward/);
  assert.throws(() => buildPointsSnapshot({ ...input, history: [{ ...input.history[0], child_id: 'child' }] }), /subject/);
});
test('RSVP conversion preserves exact claimed identity, status, false payment and timestamp', () => {
  const [row] = buildClaimedRsvps({ events: [{ id: 'e1' }], rsvps: [rsvp], claims });
  assert.equal(row.account_id, principal.toText());
  assert.equal(row.state, 'going');
  assert.deepEqual(row.has_paid, [false]);
  assert.equal(row.updated_at_ms, 1792972800000n);
});
test('RSVP missing claims, foreign events, duplicate subjects and unsupported award receipts refuse', () => {
  for (const extra of [{ user_id: 'missing' }, { event_id: 'foreign' }, { attendance_points_awarded: true }, { mini_league_player_id: 'player' }]) {
    assert.throws(() => buildClaimedRsvps({ events: [{ id: 'e1' }], rsvps: [{ ...rsvp, ...extra }], claims }));
  }
  assert.throws(() => buildClaimedRsvps({ events: [{ id: 'e1' }], rsvps: [rsvp, rsvp], claims }), /Duplicate/);
});
test('rewards writer refuses missing claims before touching the destination', async () => {
  let calls = 0;
  const data = { clubs: [input.club], club_subscriptions: [], club_rewards: input.rewards, user_club_points: input.users,
    child_club_points: [], points_history: input.history, reward_redemptions: input.redemptions, points_cooldowns: input.cooldowns };
  await assert.rejects(WRITERS.rewards({ clubId: 'c1', claims: new Map(), rows: async t => data[t], require: () => { calls++; throw Error('unexpected destination'); } }), /claim/);
  assert.equal(calls, 0);
});
test('rewards writer reads every ledger, fences exact club and submits a decodable snapshot before acknowledgement', async () => {
  const data = { clubs: [input.club], club_subscriptions: [], club_rewards: input.rewards, user_club_points: input.users,
    child_club_points: [], points_history: input.history, reward_redemptions: input.redemptions, points_cooldowns: input.cooldowns };
  const reads = [], calls = [];
  const type = await snapshotType(require, new URL('./migrate-schemas/club_points_domain.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const result = await WRITERS.rewards({ clubId: 'c1', claims, target: { canisters: { club_points_domain: 'destination' } },
    rows: async t => { reads.push(t); return data[t]; }, schemaFile: () => new URL('./migrate-schemas/club_points_domain.snapshot.did.js', import.meta.url).href,
    require: name => name === '@icp-sdk/core/agent' ? { Actor: { createActor: (_, options) => {
      assert.equal(options.canisterId, 'destination');
      return { set_transfer_fence: async (club, on) => { calls.push('fence'); assert.equal(club, 'c1'); assert.equal(on, true); return { Ok: null }; },
        import_club_snapshot: async (club, bytes) => { calls.push('import'); assert.equal(club, 'c1');
          const [back] = IDL.decode([type], bytes); assert.equal(back.users[0].points, 75);
          assert.equal(back.redemptions[0].status, 'fulfilled'); return { Ok: 1n }; } };
    } } } : require(name) });
  assert.deepEqual(reads.sort(), Object.keys(data).sort());
  assert.deepEqual(calls, ['fence', 'import']);
  assert.equal(result.records, 6);
});
test('points inventory includes child balances, cooldowns and module settings in the checked plan', () => {
  const tables = STEPS.find(s => s.id === 'rewards').tables.map(t => t[0]);
  for (const t of ['child_club_points', 'points_cooldowns', 'club_subscriptions']) assert.ok(tables.includes(t));
});
test('points snapshot declaration matches the private source contract exactly', () => {
  const source = readFileSync(new URL('../backend/club_points_domain/src/main.mo', import.meta.url), 'utf8');
  const did = readFileSync(new URL('./migrate-schemas/club_points_domain.snapshot.did', import.meta.url), 'utf8');
  const fields = source.match(/type PointsSnapshot = \{([^}]+)\}/)[1].split(';').map(s => s.trim()).filter(Boolean);
  for (const f of fields) {
    const [, name, type] = f.match(/^(\w+)\s*:\s*\[Types\.(\w+)\]$/);
    assert.ok(did.includes(`${name}: vec ${type};`));
  }
});