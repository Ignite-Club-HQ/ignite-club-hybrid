import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, assertMigrationOwner, gateReasons, buildPlan, newJournal, nextAction, recordIntent, recordReply, mayRoute, STEPS, STEP_ORDER, CONFIRM_MIGRATE } from './migrate-club-plan.mjs';

const canisters = Object.fromEntries(STEPS.map(s => [s.domain, `${s.domain}-id`]));
const target = { canisters, mediaStore: 'blob' };
const inventory = { clubFound: true, counts: { teams: 3 }, mediaFiles: 2, mediaBytes: 100 };

test('only the configured owner can start or rerun live actions; absent owner disables them', () => {
  assert.doesNotThrow(() => assertMigrationOwner('check', {}));
  const env = { GITHUB_ACTIONS: 'true', MIGRATION_OWNER_GITHUB_LOGIN: 'owner', GITHUB_ACTOR: 'owner', GITHUB_TRIGGERING_ACTOR: 'owner' };
  for (const action of ['migrate', 'recover', 'invite']) {
    assert.doesNotThrow(() => assertMigrationOwner(action, env));
    for (const bad of [{}, { ...env, MIGRATION_OWNER_GITHUB_LOGIN: '' }, { ...env, GITHUB_ACTOR: 'other' }, { ...env, GITHUB_TRIGGERING_ACTOR: 'other' }, { ...env, GITHUB_ACTIONS: 'false' }]) {
      assert.throws(() => assertMigrationOwner(action, bad), /configured owner/);
    }
  }
});

test('check needs only club and group; migrate needs plan hash and exact words', () => {
  assert.doesNotThrow(() => validateRequest({ action: 'check', clubId: 'abc-1', groupId: 'g2' }));
  assert.throws(() => validateRequest({ action: 'check', clubId: 'abc', groupId: 'two' }));
  assert.throws(() => validateRequest({ action: 'migrate', approvalScope: 'data', clubId: 'abc', groupId: 'g2', plan: 'a'.repeat(64), confirmation: 'yes' }));
  assert.doesNotThrow(() => validateRequest({ action: 'migrate', approvalScope: 'data', clubId: 'abc', groupId: 'g2', plan: 'A'.repeat(64), confirmation: ` ${CONFIRM_MIGRATE.toLowerCase()} ` }));
});

test('data copying requires explicit data approval; auth approval never authorizes it', () => {
  for (const action of ['migrate', 'recover']) {
    const req = { action, clubId: 'abc', groupId: 'g2', plan: 'a'.repeat(64), confirmation: action === 'migrate' ? CONFIRM_MIGRATE : 'RECOVER CLUB MIGRATION' };
    for (const approvalScope of [undefined, 'none', 'auth']) assert.throws(() => validateRequest({ ...req, approvalScope }), /Separate data migration approval/);
    assert.doesNotThrow(() => validateRequest({ ...req, approvalScope: 'data' }));
  }
});

test('account claims require separate auth approval; data approval never authorizes them', () => {
  const req = { action: 'invite', clubId: 'abc', groupId: 'g2', confirmation: 'SEND CLAIM EMAILS' };
  for (const approvalScope of [undefined, 'none', 'data']) assert.throws(() => validateRequest({ ...req, approvalScope }), /Separate auth migration approval/);
  assert.doesNotThrow(() => validateRequest({ ...req, approvalScope: 'auth' }));
});

test('refuses clubs already on-chain, unreadable checks and groups past 80%', () => {
  const ok = gateReasons({ inventory, target, clubOnChain: false, usage: { club_domain: 10, media_blob_store: 10 }, limits: { club_domain: 100, media_blob_store: 1000 } });
  assert.deepEqual(ok, []);
  assert.match(gateReasons({ inventory, target, clubOnChain: 'g1', usage: {}, limits: {} }).join(), /already exists/);
  assert.match(gateReasons({ inventory, target, clubOnChain: null, usage: {}, limits: {} }).join(), /Could not confirm/);
  assert.match(gateReasons({ inventory, target, clubOnChain: false, usage: { club_domain: 81 }, limits: { club_domain: 100 } }).join(), /80% fill/);
  assert.match(gateReasons({ inventory: { ...inventory, mediaBytes: 800 }, target, clubOnChain: false, usage: { media_blob_store: 10 }, limits: { media_blob_store: 1000 } }).join(), /80% fill/);
  assert.match(gateReasons({ inventory, target, clubOnChain: false, usage: {}, limits: { club_domain: 100 } }).join(), /Could not read/);
});

test('plan hash changes when counts or target change', () => {
  const a = buildPlan({ clubId: 'c', groupId: 'g2', revision: 'r', inventory, target }).hash;
  assert.equal(a.length, 64);
  assert.notEqual(a, buildPlan({ clubId: 'c', groupId: 'g2', revision: 'r', inventory: { ...inventory, counts: { teams: 4 } }, target }).hash);
  assert.notEqual(a, buildPlan({ clubId: 'c', groupId: 'g3', revision: 'r', inventory, target }).hash);
});

test('journal resumes from the next page and never replays an unknown outcome', () => {
  let j = newJournal('h');
  assert.deepEqual(nextAction(j), { step: STEP_ORDER[0], page: 0 });
  j = recordIntent(j, 'club', 0);
  assert.match(nextAction(j).blocked, /without a recorded reply/);
  assert.throws(() => recordIntent(j, 'club', 0));
  j = recordReply(j, 'club', 0, { ok: true, last: false });
  assert.deepEqual(nextAction(j), { step: 'club', page: 1 });
  j = recordReply(recordIntent(j, 'club', 1), 'club', 1, { unknown: true });
  assert.match(nextAction(j).blocked, /unknown/);
});

test('routing switches only after all data steps and verification are done', () => {
  let j = newJournal('h');
  for (const s of STEP_ORDER.slice(0, -2)) j = recordReply(recordIntent(j, s, 0), s, 0, { ok: true, last: true });
  assert.equal(mayRoute(j), false);
  j = recordReply(recordIntent(j, 'verify', 0), 'verify', 0, { ok: true, last: true });
  assert.equal(mayRoute(j), true);
});
