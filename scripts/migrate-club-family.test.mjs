import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { prepareFamilyCopy, buildFamilyMemberships } from './migrate-club-family.mjs';
import { buildClubSnapshot, snapshotType, WRITERS } from './migrate-club-writers.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Principal } = require('@icp-sdk/core/principal');
const { MasterPublicKey, IbeCiphertext } = await import(new URL('../frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js', import.meta.url).href);
const parent = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const guardian = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');
const now = '2026-10-26T00:00:00Z';
const target = { groupId: 'g2', canisters: { club_domain: parent.toText(), pii_access_control: guardian.toText() } };
const publicKey = MasterPublicKey.productionKey('key_1').deriveCanisterKey(guardian.toUint8Array())
  .deriveSubKey(new TextEncoder().encode('ignite-pii-v1')).publicKeyBytes();
const input = {
  clubId: 'c1', groupId: 'g2', target, publicKey,
  destination: { clubId: 'c1', groupId: 'g2', clubDomain: parent.toText(), piiDomain: guardian.toText(), childIds: new Set(), piiIds: new Set() },
  claims: new Map([['parent', parent], ['guardian', guardian]]),
  accounts: new Map([['parent', { principal: parent.toText(), accountId: 'verified-account' }]]),
  teams: [{ id: 't1', club_id: 'c1', name: 'Team' }],
  children: [{ id: 'child1', name: 'Private child name', year_of_birth: 2016, parent_id: 'parent', ignite_points: 0, created_at: now }],
  assignments: [{ id: 'a1', child_id: 'child1', team_id: 't1' }],
  guardians: [{ id: 'g1', child_id: 'child1', guardian_id: 'guardian', relationship_type: 'aunt', is_primary: false, created_at: now }],
  userRoles: [{ id: 'r1', club_id: 'c1', team_id: 't1', user_id: 'parent', role: 'coach', via_captain: false }],
};

test('child fields are encrypted with app-compatible identities, parents and explicit guardians only', async () => {
  const copy = await prepareFamilyCopy(input);
  assert.deepEqual(copy.domain.children[0].teams, ['t1']);
  assert.equal(copy.domain.children[0].parent[0].toText(), parent.toText());
  assert.equal(copy.domain.guardians[0].user.toText(), guardian.toText());
  assert.equal(JSON.stringify(copy.domain).includes('Private child name'), false);
  assert.equal('year_of_birth' in copy.domain.children[0], false);
  assert.deepEqual(copy.pii.records.map(r => r.field_id), ['name', 'year_of_birth']);
  for (const r of copy.pii.records) {
    assert.equal(r.domain_owner.toText(), parent.toText());
    assert.deepEqual(r.readers.map(p => p.toText()), [guardian.toText()]);
    assert.equal(r.master_key_id, 'vetkey-ibe-v1');
    assert.equal(r.created_at, 1792972800000000000n);
    assert.ok(IbeCiphertext.deserialize(r.ciphertext));
    assert.equal(new TextDecoder().decode(r.ciphertext).includes('Private child name'), false);
  }
  assert.deepEqual(copy.pii.guardians[0].children, ['child1']);
  assert.deepEqual(copy.pii.guardian_labels[0][0].is_primary, [false]);
  assert.deepEqual(copy.pii.guardian_labels[0][0].rel_label, ['aunt']);
  assert.deepEqual(copy.counts, { children: 1, guardians: 1, privateFields: 2, roles: 1 });
});
test('prepared family fragment encodes within the actual club snapshot without overwriting club structure', async () => {
  const copy = await prepareFamilyCopy(input);
  const snap = { ...buildClubSnapshot({ club: { id: 'c1', name: 'Club' }, teams: input.teams }), ...copy.domain };
  const type = await snapshotType(require, new URL('./migrate-schemas/club_domain.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const [back] = IDL.decode([type], IDL.encode([type], [snap]));
  assert.equal(back.profiles[0].name, 'Club');
  assert.equal(back.teams[0].id, 't1');
  assert.equal(back.children[0].id, 'child1');
  assert.equal(back.roles[0].user.toText(), parent.toText());
  assert.equal(back.account_roles[0].account_id, 'verified-account');
});
test('the children writer exists and stays bound to exact-destination evidence', () => {
  assert.equal(typeof WRITERS.children, 'function');
  // The writer only runs inside the journaled, separately approved data run;
  // preparation itself still performs no network or canister calls.
});
test('data evidence binds the exact club, group and both destination services', async () => {
  for (const patch of [{ clubId: 'c2' }, { groupId: 'g1' }, { clubDomain: 'other' }, { piiDomain: 'other' }, { childIds: undefined }, { piiIds: undefined }]) {
    await assert.rejects(prepareFamilyCopy({ ...input, destination: { ...input.destination, ...patch } }), /exact-destination/);
  }
});
test('existing child or PII IDs refuse instead of replacing another club family', async () => {
  for (const key of ['childIds', 'piiIds']) {
    await assert.rejects(prepareFamilyCopy({ ...input, destination: { ...input.destination, [key]: new Set(['child1']) } }), /Existing destination family/);
  }
});
test('parent and guardian claims must both exist and cannot be anonymous', async () => {
  for (const claims of [new Map([['parent', parent]]), new Map([['guardian', guardian]]), new Map([['parent', Principal.anonymous()], ['guardian', guardian]])]) {
    await assert.rejects(prepareFamilyCopy({ ...input, claims }), /claim/);
  }
});
test('account claim alone creates no membership and never invents a destination account ID', () => {
  assert.deepEqual(buildFamilyMemberships({ ...input, userRoles: [] }).roles, []);
  assert.throws(() => buildFamilyMemberships({ ...input, accounts: new Map() }), /destination identity account/);
  assert.throws(() => buildFamilyMemberships({ ...input, accounts: new Map([['parent', { accountId: 'u1', principal: guardian.toText() }]]) }), /destination identity account/);
});
test('foreign child assignments and dangling guardians are rejected, not silently filtered', async () => {
  for (const patch of [
    { assignments: [{ ...input.assignments[0], team_id: 'foreign' }] },
    { assignments: [{ ...input.assignments[0], child_id: 'unknown' }] },
    { assignments: [] },
    { guardians: [{ ...input.guardians[0], child_id: 'unknown' }] },
    { teams: [{ ...input.teams[0], club_id: 'other' }] },
  ]) await assert.rejects(prepareFamilyCopy({ ...input, ...patch }));
});
test('duplicate children, assignments and guardian relationships refuse', async () => {
  for (const key of ['children', 'assignments', 'guardians']) {
    await assert.rejects(prepareFamilyCopy({ ...input, [key]: [...input[key], ...input[key]] }), /Duplicate/);
  }
});
test('unrepresentable season memberships, team exclusions and global child points cannot disappear', async () => {
  await assert.rejects(prepareFamilyCopy({ ...input, memberships: [{ id: 'season-row' }] }), /season-membership/);
  await assert.rejects(prepareFamilyCopy({ ...input, teamExclusions: [{ team_id: 't1' }] }), /team-exclusion/);
  await assert.rejects(prepareFamilyCopy({ ...input, children: [{ ...input.children[0], ignite_points: 50 }] }), /global child points/);
});
test('membership grants preserve explicit scope and exclusions but refuse platform or derived captain powers', () => {
  const copy = buildFamilyMemberships({ ...input, exclusions: [{ club_id: 'c1', user_id: 'parent' }] });
  assert.equal(copy.roles[0].role, 'coach');
  assert.deepEqual(copy.roles[0].team, ['t1']);
  assert.equal(copy.exclusions[0].user.toText(), parent.toText());
  for (const patch of [{ role: 'app_admin' }, { role: 'competition_admin' }, { role: 'unknown' }, { via_captain: true }, { team_id: null }, { club_id: 'other' }]) {
    assert.throws(() => buildFamilyMemberships({ ...input, userRoles: [{ ...input.userRoles[0], ...patch }] }));
  }
});
test('private encryption pins the production destination key and uses fresh ciphertext on each preparation', async () => {
  const first = await prepareFamilyCopy(input), second = await prepareFamilyCopy(input);
  assert.notDeepEqual(first.pii.records[0].ciphertext, second.pii.records[0].ciphertext);
  const wrongKey = publicKey.slice(); wrongKey[0] ^= 1;
  await assert.rejects(prepareFamilyCopy({ ...input, publicKey: wrongKey }), /public key mismatch/);
});
test('invalid private values and missing owner stop rather than generating corrupt child records', async () => {
  for (const patch of [{ name: '' }, { year_of_birth: 2016.5 }, { parent_id: null }, { created_at: 'invalid' }]) {
    await assert.rejects(prepareFamilyCopy({ ...input, children: [{ ...input.children[0], ...patch }] }));
  }
});