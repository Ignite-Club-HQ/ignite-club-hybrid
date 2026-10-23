import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_GROUP1_CLUBS, readCompleteSourceClubs, verifyOwnerNamedGroup1Clubs, checkLegacyOwnership, verifyCompleteClubLocations } from './membership-legacy-ownership.mjs';

const ids = Object.values(OWNER_GROUP1_CLUBS);
const club = (id, deleted = false) => ({ Club: { id, deleted } });
const source = (groupId, rows, revision = 7n) => ({ groupId, revision, scanned: rows.length, clubs: new Map(rows) });
const good = () => [source('g1', ids.map(id => [id, false])), source('g2', [['group-2-club', false]], 3n)];

test('owner-named Winter Cats, Giddy Goat and Riverdogs verify only as exclusive live Group 1 IDs', () => {
  assert.deepEqual(verifyOwnerNamedGroup1Clubs(good(), good()).map(r => [r.name, r.groupId]), [['Winter Cats', 'g1'], ['Giddy Goat', 'g1'], ['Riverdogs', 'g1']]);
});

test('missing, deleted, duplicated or foreign named clubs fail closed', () => {
  for (const sources of [
    [source('g1', ids.slice(1).map(id => [id, false])), good()[1]],
    [source('g1', ids.map((id, n) => [id, n === 0])), good()[1]],
    [good()[0], source('g2', [[ids[0], false]], 3n)],
    [source('g2', ids.map(id => [id, false]), 3n)],
  ]) assert.throws(() => verifyOwnerNamedGroup1Clubs(sources, sources));
});

test('every legacy club is checked, not only the three supplied names', () => {
  const all = [...good(), source('g3', [['other-test-club', false]], 9n)];
  const locations = verifyCompleteClubLocations(all, all);
  assert.equal(locations.length, 5);
  assert.deepEqual(locations.find(c => c.clubId === 'other-test-club'), { clubId: 'other-test-club', groupId: 'g3', deleted: false, revision: '9' });
  for (const deleted of [false, true]) {
    const conflict = [...all, source('g4', [['other-test-club', deleted]], 2n)];
    assert.throws(() => verifyCompleteClubLocations(conflict, conflict), /conflicting/);
  }
  assert.throws(() => verifyCompleteClubLocations(all, all.slice(0, 2)), /Complete/);
  assert.throws(() => verifyCompleteClubLocations(all, [...good(), source('g3', [['other-test-club', false]], 10n)]), /changed/);
});

test('source changes, omitted groups and incomplete traversals are refused', async () => {
  assert.throws(() => verifyOwnerNamedGroup1Clubs(good(), [good()[0]]), /Complete/);
  assert.throws(() => verifyOwnerNamedGroup1Clubs(good(), [source('g1', ids.map(id => [id, false]), 8n), good()[1]]), /changed/);
  const pages = [{ Ok: { revision: 7n, edges: [club(ids[0])], scanned: 1n, next: [{ revision: 7n, phase: 0n, offset: 1n, nested: 0n }] } },
    { Ok: { revision: 8n, edges: [club(ids[1])], scanned: 1n, next: [] } }];
  await assert.rejects(() => readCompleteSourceClubs('g1', async () => pages.shift()), /changed/);
  await assert.rejects(() => readCompleteSourceClubs('g1', async () => ({ Ok: { revision: 7n, edges: [], scanned: 0n, next: [{ revision: 7n, phase: 0n, offset: 0n, nested: 0n }] } })), /advance/);
  await assert.rejects(() => readCompleteSourceClubs('g1', async () => ({ Err: 'Governor required' })), /refused/);
});

test('bounded reader follows exact cursors and returns club tombstones', async () => {
  const cursors = [];
  const pages = [{ Ok: { revision: 7n, edges: [club(ids[0]), { Role: {} }], scanned: 2n, next: [{ revision: 7n, phase: 1n, offset: 0n, nested: 0n }] } },
    { Ok: { revision: 7n, edges: [club(ids[1], true)], scanned: 1n, next: [] } }];
  const result = await readCompleteSourceClubs('g1', async cursor => { cursors.push(cursor); return pages.shift(); });
  assert.equal(cursors[0], null); assert.equal(cursors[1].phase, 1n);
  assert.deepEqual([...result.clubs], [[ids[0], false], [ids[1], true]]);
});

test('operator flow checks every registered source including Group 3 twice and never authorizes readiness', async () => {
  const sources = ['g1', 'g2', 'g3'].map(groupId => ({ groupId, canisterId: `${groupId}-authority` }));
  const calls = [];
  const report = await checkLegacyOwnership({
    registry: async () => ({ fingerprint: 'revision-9', sources }),
    read: async s => { calls.push(s.groupId); return { Ok: { revision: 7n, scanned: s.groupId === 'g1' ? 3n : 0n, edges: s.groupId === 'g1' ? ids.map(id => club(id)) : [], next: [] } }; },
    status: async () => ({ revision: 7n }),
  });
  assert.deepEqual(calls, ['g1', 'g2', 'g3', 'g1', 'g2', 'g3']);
  assert.equal(report.ready, false); assert.equal(report.appEnabled, false);
  assert.equal(report.clubs.length, 3);
});

test('late mutations and registry changes reject the whole operator observation', async () => {
  const sources = [{ groupId: 'g1', canisterId: 'authority' }];
  const transport = {
    registry: async () => ({ fingerprint: 'revision-9', sources }),
    read: async () => ({ Ok: { revision: 7n, scanned: 3n, edges: ids.map(id => club(id)), next: [] } }),
    status: async () => ({ revision: 8n }),
  };
  await assert.rejects(() => checkLegacyOwnership(transport), /changed after/);
  let n = 0;
  await assert.rejects(() => checkLegacyOwnership({ ...transport, registry: async () => ({ fingerprint: ++n === 1 ? 'old' : 'new', sources }) }), /inventory changed/);
});

test('malformed terminal replies, repeated cursors and excessive work cannot prove inventory completion', async () => {
  for (const page of [
    { revision: 7n, scanned: 0n, edges: [] },
    { revision: 7n, scanned: 101n, edges: [], next: [] },
    { revision: 7n, scanned: 0n, edges: [club(ids[0])], next: [] },
    { revision: 7n, scanned: 1n, edges: [null], next: [] },
  ]) await assert.rejects(() => readCompleteSourceClubs('g1', async () => ({ Ok: page })));
  const cursor = { revision: 7n, phase: 0n, offset: 1n, nested: 0n };
  let calls = 0;
  await assert.rejects(() => readCompleteSourceClubs('g1', async () => { calls++; return { Ok: { revision: 7n, scanned: 1n, edges: [], next: [cursor] } }; }), /advance/);
  assert.equal(calls, 2);
});