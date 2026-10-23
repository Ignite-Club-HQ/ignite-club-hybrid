import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRequest, validateTargets, validateJournal, runFill, digest, PINNED, requireLookupReleaseAcceptance, directorySources, requireReleaseSourceCoverage, lookupReleaseTargets, PRIMARY_SUBNET, lookupUpgradeArgs } from './membership-lookup-release-policy.mjs';

const targets = [
  { canisterId: PINNED.identity, groupId: 'shared', name: 'identity_access', subnetId: 'subnet', newHash: 'a'.repeat(64) },
  ...['g1', 'g2'].map(groupId => ({ canisterId: PINNED[groupId], groupId, name: 'club_domain', subnetId: 'subnet', newHash: 'b'.repeat(64) })),
];
const binding = { targets, governor: 'gov' };
const step = t => ({ ...t, oldHash: 'c'.repeat(64), settingsHash: 'd'.repeat(64), phase: 'complete' });
const journal = (overrides = {}) => ({ binding, complete: true, steps: targets.map(step), fill: { g1: true, g2: true }, ...overrides });
const snapshot = (groups = ['g2']) => ({ revision: 9n,
  groups: groups.map(id => ({ id, target_alias: 'mainnet', domains: [{ domain: 'club_domain', canister: PINNED[id] ?? `${id}-authority` }] })),
  placements: groups.map(id => ({ group_id: id, deployment_id: 'mainnet', deployment_revision: 1n, host: 'https://icp-api.io', network_kind: 'public_mainnet', domains: [{ domain: 'club_domain', canister: PINNED[id] ?? `${id}-authority` }] })),
});

test('source inventory explicitly includes original Group 1 without inventing a placement', () => {
  const before = snapshot(); const rows = directorySources(before);
  assert.deepEqual(rows, [{ groupId: 'g1', canisterId: PINNED.g1 }, { groupId: 'g2', canisterId: PINNED.g2 }]);
  assert.equal(before.groups.length, 1); assert.equal(before.placements.length, 1);
  requireReleaseSourceCoverage(rows);
  assert.deepEqual(directorySources(snapshot(['g1', 'g2'])), rows);
});

test('additional registered groups require exact full-source release coverage', () => {
  const rows = directorySources(snapshot(['g3', 'g2']));
  assert.deepEqual(rows.map(s => s.groupId), ['g1', 'g2', 'g3']);
  requireReleaseSourceCoverage(rows, snapshot(['g3', 'g2']));
  assert.throws(() => requireReleaseSourceCoverage(rows.filter(s => s.groupId !== 'g2'), snapshot(['g3', 'g2'])), /no changes/);
});

test('source inventory refuses mismatched original, duplicates, missing placements and foreign deployment', () => {
  for (const change of [
    s => { s.groups[0].id = 'g1'; s.placements[0].group_id = 'g1'; },
    s => { s.groups.push(s.groups[0]); s.placements.push(s.placements[0]); },
    s => { s.placements = []; },
    s => { s.placements[0].host = 'https://other.invalid'; },
    s => { s.placements[0].domains[0].canister = PINNED.g1; },
    s => { s.groups[0].domains.push({ domain: 'events_domain', canister: PINNED.g1 }); },
    s => { s.revision = 0n; },
  ]) { const bad = snapshot(); change(bad); assert.throws(() => directorySources(bad)); }
});

test('requires the exact confirmation and exactly the three existing lookup targets', () => {
  validateRequest('upgrade', ' RELEASE MEMBERSHIP LOOKUP\n'); validateRequest('check', '');
  assert.throws(() => validateRequest('upgrade', 'UPGRADE BOTH GROUPS PHOTOS'));
  validateTargets(targets);
  assert.throws(() => validateTargets([...targets, targets[0]]));
  assert.throws(() => validateTargets(targets.filter(t => t.name !== 'identity_access')));
  assert.throws(() => validateTargets(targets.map(t => ({ ...t, name: 'media_metadata' }))));
  assert.throws(() => validateTargets(targets.map(t => t.groupId === 'g2' ? { ...t, canisterId: PINNED.g1 } : t)));
});

test('repository mappings match the pinned lookup services', () => {
  const root = new URL('../', import.meta.url);
  const shared = JSON.parse(readFileSync(new URL('deploy/mainnet/.icp/data/mappings/ic.ids.json', root)));
  const provision = JSON.parse(readFileSync(new URL('deploy/groups/g2/provision.json', root)));
  assert.equal(shared.identity_access, PINNED.identity);
  assert.equal(shared.club_domain, PINNED.g1);
  assert.equal(provision.canisters.club_domain, PINNED.g2);
});

test('rejects foreign, incomplete, substituted or unsettled journals', () => {
  validateJournal(journal(), binding);
  assert.throws(() => validateJournal(journal({ binding: { ...binding, governor: 'other' } }), binding));
  assert.throws(() => validateJournal(journal({ steps: journal().steps.slice(0, 2) }), binding));
  assert.throws(() => validateJournal(journal({ steps: journal().steps.map(s => s.groupId === 'g1' ? { ...s, newHash: 'e'.repeat(64) } : s) }), binding));
  assert.throws(() => validateJournal(journal({ complete: true, steps: journal().steps.map(s => ({ ...s, phase: 'pending' })) }), binding));
  assert.throws(() => validateJournal(journal({ steps: journal().steps.map(s => ({ ...s, oldHash: 'not-a-hash' })) }), binding));
});

test('historical fill never certifies readiness, even after both groups complete', () => {
  assert.throws(() => validateJournal(journal({ ready: true }), binding), /cannot certify/);
  assert.throws(() => validateJournal(journal({ ready: true, complete: false }), binding));
  assert.throws(() => validateJournal(journal({ ready: true, fill: { g1: true, g2: false } }), binding));
  assert.throws(() => validateJournal(journal({ fill: { g1: 'yes', g2: true } }), binding));
});

test('fill uses each exact source and persists only its acknowledged revision', async () => {
  const left = { g1: 3, g2: 1 }; let flaky = true;
  const persisted = [];
  const done = await runFill(['g1', 'g2'], async g => {
    if (g === 'g2' && flaky) { flaky = false; throw new Error('timeout'); }
    left[g]--; return { Ok: { source: g, revision: g === 'g1' ? 7n : 11n, scanned: 100n, phase: left[g] <= 0 ? 'acknowledged' : 'materialize' } };
  }, { persist: async (g, revision) => { persisted.push([g, revision]); } });
  assert.deepEqual(done, { g1: 7n, g2: 11n });
  assert.deepEqual(persisted, [['g1', 7n], ['g2', 11n]]);
});

test('fill stops on refusal and never loops forever', async () => {
  await assert.rejects(() => runFill(['g1'], async () => ({ Err: 'Governor required' })), /refused/);
  await assert.rejects(() => runFill(['g1'], async () => ({ Ok: { source: 'g1', revision: 1n, scanned: 0n, phase: 'published' } }), { maxCalls: 3 }), /did not finish/);
});

test('local reader contract permits protected release but does not claim live readiness', () => {
  assert.equal(requireLookupReleaseAcceptance(), 'snapshot-checked-private-pages-v1');
});

test('fill rejects wrong sources, fabricated completion, malformed and unbounded progress', async () => {
  const valid = { source: 'g1', revision: 1n, scanned: 0n, phase: 'acknowledged' };
  for (const progress of [{ ...valid, source: 'g2' }, { scanned: 0n, complete: true }, { ...valid, revision: 0n }, { ...valid, scanned: 101n }, { ...valid, scanned: -1n }, { ...valid, phase: 'complete' }, { ...valid, revision: 1 }]) {
    let persisted = false;
    await assert.rejects(() => runFill(['g1'], async () => ({ Ok: progress }), { persist: async () => { persisted = true; } }), /Invalid membership progress/);
    assert.equal(persisted, false);
  }
  await assert.rejects(() => runFill(['g1'], async () => null), /Invalid membership progress/);
  await assert.rejects(() => runFill(['g1', 'g1'], async () => ({ Ok: valid })), /source list/);
  await assert.rejects(() => runFill(['g3'], async () => ({ Ok: valid })), /Invalid membership progress/);
});

test('unknown replies exhaust retries and failed persistence stops the next source', async () => {
  let attempts = 0;
  await assert.rejects(() => runFill(['g1'], async () => { attempts++; throw new Error('timeout'); }, { retries: 2 }), /timeout/);
  assert.equal(attempts, 3);
  const called = [];
  await assert.rejects(() => runFill(['g1', 'g2'], async g => {
    called.push(g); return { Ok: { source: g, revision: 1n, scanned: 0n, phase: 'acknowledged' } };
  }, { persist: async () => { throw new Error('readback failed'); } }), /readback failed/);
  assert.deepEqual(called, ['g1']);
});

test('journal binding digest covers the exact target set', () => {
  const other = { ...binding, targets: targets.map(t => ({ ...t, newHash: 'f'.repeat(64) })) };
  assert.notEqual(digest(binding), digest(other));
});
test('restart rejects fabricated activation and contradictory saved source revisions', () => {
  for (const changes of [{ appEnabled: true }, { verified_current: true }, { acknowledgedRevisions: { g1: '0' } }, { acknowledgedRevisions: { g3: '7' } }, { acknowledgedRevisions: { g1: '7' }, fill: { g1: false, g2: true } }]) {
    assert.throws(() => validateJournal(journal(changes), binding));
  }
  validateJournal(journal({ acknowledgedRevisions: { g1: '7', g2: '9' } }), binding);
});
test('G2 G3 G4 produce five exact targets and no media or chat upgrade', () => {
  const s = snapshot(['g2','g3','g4']);
  for (const p of s.placements) {
    p.primary_subnet = PRIMARY_SUBNET; p.approved_subnets = [PRIMARY_SUBNET]; p.additional_subnets_enabled = false;
    p.domains[0].subnet = PRIMARY_SUBNET;
  }
  const sources = directorySources(s), plan = lookupReleaseTargets(s, {identity_access:'a'.repeat(64),club_domain:'b'.repeat(64)});
  assert.equal(plan.length,5);assert.deepEqual(plan.map(t => t.groupId),['shared','g1','g2','g3','g4']);
  validateTargets(plan,sources);
  assert.throws(() => validateTargets(plan.slice(0,-1),sources));
  assert.throws(() => validateTargets([...plan,{...plan[0],canisterId:'foreign'}],sources));
  const binding = {sources,targets:plan}, j = {binding,complete:false,steps:plan.map(step),fill:Object.fromEntries(sources.map(s=>[s.groupId,false]))};
  validateJournal(j,binding);
  assert.throws(()=>validateJournal({...j,fill:{...j.fill,extra:false}},binding));
  assert.throws(()=>validateJournal({...j,steps:j.steps.slice(1)},binding));
  s.placements[1].domains[0].subnet='foreign-subnet';
  assert.throws(()=>lookupReleaseTargets(s,{identity_access:'a'.repeat(64),club_domain:'b'.repeat(64)}),/subnet/);
});
test('all valid sources fill and over-budget inventories refuse before a release', async () => {
  const called=[];
  const done=await runFill(['g1','g2','g3','g4'],async source=>{called.push(source);return {Ok:{source,revision:7n,scanned:0n,phase:'acknowledged'}};});
  assert.deepEqual(called,['g1','g2','g3','g4']);assert.equal(Object.keys(done).length,4);
  const oversized=directorySources(snapshot(['g2',...Array.from({length:100},(_,n)=>`x${n}`)]));
  assert.throws(()=>requireReleaseSourceCoverage(oversized),/no changes/);
});
test('identity upgrade uses its record init while club upgrades retain principal init',()=>{
  const governor='vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
  for(const t of targets){const args=lookupUpgradeArgs(t,'/tmp/module',governor);
    assert.equal(args[args.indexOf('--args')+1],t.name==='identity_access'?`(record { governor = principal "${governor}" })`:`(principal "${governor}")`);
    assert.equal(args[args.indexOf('--mode')+1],'upgrade');
    assert.equal(args.includes('--wasm-memory-persistence'),t.name==='club_domain');
    if(t.name==='club_domain')assert.equal(args[args.indexOf('--wasm-memory-persistence')+1],'keep');
  }
});
test('activation restart requires the exact release and settled snapshot checkpoint',()=>{
  const release='a'.repeat(40), b={...binding,release};
  const j={...journal(),binding:b,replicaAcceptance:{snapshotVerified:true,restorationGuardVerified:true},activation:{release,phase:'pending'}};
  validateJournal(j,b);
  for(const changes of [{activation:{release:'b'.repeat(40),phase:'pending'}},{complete:false},{replicaAcceptance:{snapshotVerified:true}}])assert.throws(()=>validateJournal({...j,...changes},b));
});
