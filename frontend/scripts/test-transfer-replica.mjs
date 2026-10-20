// Isolated practice move between two local groups (never mainnet). Each group
// has real club_domain, events_domain, messaging_domain and vault_domain
// canisters; the production runner + live adapter move one club across.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as vaultIdl } from '../src/lab/bindings/vault_domain/declarations/vault_domain.did.js';
import { idlFactory as eventsIdl } from '../src/lab/bindings/events_domain/declarations/events_domain.did.js';
import { idlFactory as chatIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as pointsIdl } from '../src/lab/bindings/club_points_domain/declarations/club_points_domain.did.js';
import { idlFactory as leagueIdl } from '../src/lab/bindings/mini_league_domain/declarations/mini_league_domain.did.js';
import { idlFactory as competitiondomainIdl } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
import { idlFactory as mediametadataIdl } from '../src/lab/bindings/media_metadata/declarations/media_metadata.did.js';
import { idlFactory as insightsdomainIdl } from '../src/lab/bindings/insights_domain/declarations/insights_domain.did.js';
import { idlFactory as notificationqueueIdl } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';
import { idlFactory as piiaccesscontrolIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as timerjobsIdl } from '../src/lab/bindings/timer_jobs/declarations/timer_jobs.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { planTransfer } from '../src/live/groupTransfer.ts';
import { runTransfer } from '../src/live/groupTransferRunner.ts';
import { approveProvision, runProvision, PER_GROUP_DOMAINS } from '../src/live/groupProvisioner.ts';
import { routerProvisionSteps } from '../src/live/groupProvisionRouter.ts';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { wireAccountGroupAuthorities } from '../src/live/accountGroupAuthorities.ts';
import { liveTransferAdapter } from '../src/live/groupTransferLiveAdapter.ts';

const root = resolve(import.meta.dirname, '../..');
const wasm = c => process.env[`${c.toUpperCase()}_WASM`] ?? (c === 'timer_jobs' ? resolve(root, 'target/wasm32-unknown-unknown/release/timer_jobs.wasm') : resolve(root, `backend/${c}/.mops/.build/${c}.wasm`));
const idls = { club_domain: clubIdl, events_domain: eventsIdl, messaging_domain: chatIdl, vault_domain: vaultIdl, club_points_domain: pointsIdl, mini_league_domain: leagueIdl, competition_domain: competitiondomainIdl, media_metadata: mediametadataIdl, insights_domain: insightsdomainIdl, notification_queue: notificationqueueIdl, pii_access_control: piiaccesscontrolIdl, timer_jobs: timerjobsIdl };
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const staff = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const ok = r => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const CLUB = 'club-move';
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const groups = { a: {}, b: {} };
  const canisterIdsA = {};
  const argFor = c => c === 'timer_jobs' ? IDL.encode([], []) : IDL.encode([IDL.Principal], [governor]);
  for (const c of Object.keys(idls)) {
    const f = await pic.setupCanister({ idlFactory: idls[c], wasm: wasm(c), sender: governor, controllers: [governor], environmentVariables: [{ name: "IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL", value: "1" }], arg: argFor(c) });
    f.actor.setPrincipal(governor); groups.a[c] = f.actor; canisterIdsA[c] = f.canisterId.toText();
    if (c === 'timer_jobs') ok(await f.actor.initialize());
  }
  // Group B is built by the production provisioner on real canisters, with a crash mid-build.
  const appSubnet = (await pic.getApplicationSubnets())[0].id.toText();
  const routerF = await pic.setupCanister({ idlFactory: routerIdl, wasm: process.env.SHARD_ROUTER_WASM ?? resolve(root, 'target/wasm32-unknown-unknown/release/shard_router.wasm'), sender: governor, controllers: [governor], environmentVariables: [{ name: "IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL", value: "1" }],
    arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  const router = routerF.actor; router.setPrincipal(governor);
  const globalWid = (await pic.createCanister({ sender: governor, controllers: [governor], targetSubnetId: Principal.fromText(appSubnet) })).toText();
  const identityFixture = await pic.setupCanister({ idlFactory: identityIdl,
    wasm: process.env.IDENTITY_ACCESS_WASM ?? resolve(root, 'target/wasm32-unknown-unknown/release/identity_access.wasm'), sender: governor, controllers: [governor], environmentVariables: [{ name: "IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL", value: "1" }],
    arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]) });
  identityFixture.actor.setPrincipal(governor);
  const authorityActors = {
    club: id => { const actor = pic.createActor(clubIdl, Principal.fromText(id)); actor.setPrincipal(governor); return actor; },
    identity: () => identityFixture.actor,
  };
  const routerSteps = routerProvisionSteps(router, { secret_workload_identity: globalWid },
    { targetAlias: 'local', deploymentId: 'local', deploymentRevision: 1n, host: 'https://icp-api.io', networkKind: 'public_mainnet', primarySubnet: appSubnet, approvedSubnets: [appSubnet], additionalSubnetsEnabled: false },
    { maxClubs: 500, heapBudgetBytes: 3n * 1024n ** 3n, minCycles: 1_000_000_000n },
    async p => wireAccountGroupAuthorities([{ groupId: 'a', clubDomain: canisterIdsA.club_domain }, { groupId: p.groupId, clubDomain: p.canisters.club_domain }], identityFixture.canisterId.toText(), authorityActors), true);
  let creates = 0; let provSaved = null;
  const provAdapter = {
    createCanister: async (_p, d) => {
      if (++creates === 3) throw new Error('Request timed out (injected)');
      const id = await pic.createCanister({ sender: governor, controllers: [governor], targetSubnetId: Principal.fromText(appSubnet) });
      await pic.updateCanisterSettings({ canisterId: id, sender: governor, environmentVariables: [{ name: "IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL", value: "1" }] });
      return { canisterId: id.toText(), subnetId: (await pic.getCanisterSubnetId(id)).toText() };
    },
    install: async (_p, d, id) => { if (!idls[d]) return; await pic.installCode({ canisterId: Principal.fromText(id), wasm: wasm(d), arg: argFor(d), sender: governor }); },
    healthy: async (_p, d, id) => (await pic.getControllers(Principal.fromText(id))).some(c => c.toText() === governor.toText()),
    ...routerSteps, save: async p => { provSaved = structuredClone(p); },
  };
  const approval = approveProvision({ kind: 'provision', deploymentId: 'local', subnetId: appSubnet, reason: 'full' }, { operator: governor.toText(), proposalId: 'p1', deploymentId: 'local', subnetId: appSubnet }, 'b', await router.version());
  const failed = await runProvision(approval, provAdapter);
  assert.equal(failed.phase, 'failed'); assert.deepEqual(ok(await router.list_groups()), [], 'incomplete group never registered');
  // The injected failure occurred before the management call; explicitly
  // reconcile that known non-commit rather than blindly replaying an intent.
  const provDone = await runProvision({ ...provSaved, pending: undefined, phase: 'approved', error: undefined }, provAdapter);
  assert.equal(provDone.phase, 'enabled', provDone.error);
  const listed = ok(await router.list_groups()); assert.equal(listed.length, 1); assert.equal(listed[0].id, 'b'); assert.equal(listed[0].accepting, true);
  const snap = ok(await router.read_group_registry('local')); assert.ok(JSON.stringify(snap, (_k, v) => typeof v === 'bigint' ? String(v) : v).includes('"b"'), 'placement recorded');
  assert.equal(new Set(Object.values(provDone.canisters)).size, PER_GROUP_DOMAINS.length, 'no duplicate canisters after resume');
  for (const c of Object.keys(idls)) {
    const actor = pic.createActor(idls[c], Principal.fromText(provDone.canisters[c])); actor.setPrincipal(governor); groups.b[c] = actor;
    if (c === 'timer_jobs') ok(await actor.initialize());
  }
  console.log('PASS provisioning: new group built on real canisters, resumed after crash, registered once in the real directory canister');
  const A = groups.a, B = groups.b;
  const refused = p => p.catch(e => ({ Err: String(e.message) }));
  const as = (actor, p, fn) => { actor.setPrincipal(p); return fn().finally(() => actor.setPrincipal(governor)); };

  // Seed the club on group A across all four domains, plus a bystander club on B.
  ok(await A.club_domain.create_club(CLUB, 'Move FC', CLUB, [], []));
  ok(await A.club_domain.add_role_grant(staff, CLUB, 'club_admin', []));
  ok(await B.club_domain.create_club('other-club', 'Other FC', 'other-club', [], []));
  const ev = ok(await A.events_domain.create_event(CLUB, [], 'Training', 'Tuesday session', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
  ok(await B.events_domain.create_event('other-club', [], 'Other', 'Stays put', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
  const conv = ok(await A.messaging_domain.create_conversation(CLUB, [], [governor]));
  for (let i = 0; i < 3; i++) ok(await A.messaging_domain.send_message(conv.id, `hello ${i}`, `k${i}`, [], []));
  ok(await A.vault_domain.grant_role(staff, 'club_admin', [CLUB], []));
  ok(await B.vault_domain.grant_role(staff, 'club_admin', [CLUB], []));
  ok(await as(A.vault_domain, staff, () => A.vault_domain.create_folder('f1', CLUB, [], [], 'Docs', [], [], [], 0, [], [])));
  ok(await as(A.vault_domain, staff, () => A.vault_domain.register_file('file1', 'f1', CLUB, [], 'rules.pdf', 'https://x/rules', 10n, 'application/pdf', false, [], [], [])));

  ok(await A.club_points_domain.grant_role(staff, 'club_admin', CLUB, []));
  const reward = ok(await A.club_points_domain.create_reward(CLUB, 'Free drink', [], 50, false, 'standard', [], false, [], []));
  ok(await A.club_points_domain.award_points(CLUB, { User: 'u1' }, 'attendance', 'ev1', 10, 'Came to training', [], [], []));
  ok(await A.mini_league_domain.grant_role(staff, 'club_admin', CLUB, []));
  const league = ok(await A.mini_league_domain.create_mini_league(CLUB, 'Under 8s', [], [], 5, 3, 10, [], true));
  // Remaining domains: competition, media records, insights, notifications, private-info grants, timers.
  const comp = ok(await A.competition_domain.create_competition(CLUB, 'Winter Cup', '2026'));
  const asset = ok(await A.media_metadata.register_asset(CLUB, 'photo', 'image/jpeg', 'sum1', `clubs/${CLUB}/p1.jpg`, 'club', 99_999_999_999_999n));
  ok(await A.insights_domain.record_photo_upload(CLUB, 'p1'));
  // Sponsor numbers: an older sponsor-only count is folded into the club on
  // the next club-filed count; a sponsor shared with another club splits.
  ok(await A.insights_domain.record_sponsor_metric('sp1', 'impressions', 1, []));
  ok(await A.insights_domain.record_sponsor_metric('sp-legacy', 'impressions', 3, [])); // never shown again: folded in by the move
  ok(await A.insights_domain.record_club_sponsor_metric(CLUB, 'sp1', 'impressions', 1, []));
  ok(await A.insights_domain.record_club_sponsor_metric(CLUB, 'sp-shared', 'impressions', 1, []));
  ok(await A.insights_domain.record_club_sponsor_metric('other-club', 'sp-shared', 'impressions', 1, []));
  ok(await A.notification_queue.enqueue('n1', 'u1', CLUB, 'news', 'Hello', 'nk1'));
  ok(await A.pii_access_control.register_pii('child-1', 'name', [1, 2, 3], governor));
  ok(await A.pii_access_control.grant_pii_read_club('child-1', 'name', CLUB));
  ok(await A.timer_jobs.schedule('job-1', CLUB, 99_999_999_999n, 'tk1'));
  ok(await B.timer_jobs.schedule('job-other', 'other-club', 99_999_999_999n, 'tk2'));
  // News post + team on club details (wider copy scope).
  const team = ok(await A.club_domain.create_shell_team_invite(CLUB, 'Under 8 Lions', [], [])).id;
  const link = ok(await A.club_domain.create_team_invite_link(CLUB, team, 'player'));
  const inflight = new Map(); let registryRev = 1n; let assignment = 'a'; const blocked = {}; const saved = [];
  const base = liveTransferAdapter({
    // Isolated fixtures below contain no ICP ciphertext/blob refs or pending
    // uploads; this is NOT a production inventory reader or activation proof.
    mediaInventory: async (fromGroup, toGroup, clubId) => ({ fromGroup, toGroup, clubId, complete: true,
      encryptedObjects: 0, pendingUploads: 0, sharedQuotaReady: true }),
    actors: g => groups[g], fenceRevision: 1n, targetFor: async club => inflight.get(club) ?? null,
    clubSponsorIds: async () => ['sp-legacy'],
    sameDeployment: async () => true,
    readRegistryRevision: async () => registryRev,
    swapAssignment: async (club, to, expected) => { assert.equal(expected, registryRev); assignment = to; registryRev += 1n; },
    save: async t => { saved.push(t.phase); ['released', 'aborted'].includes(t.phase) ? inflight.delete(t.clubId) : inflight.set(t.clubId, t.toGroup); },
  });
  const adapter = { ...base, setFence: async (g, club, on) => {
    await base.setFence(g, club, on);
    if (on && g === 'a') { // writes in every domain must be refused while moving
      blocked.event = await refused(A.events_domain.create_event(CLUB, [], 'Sneaky', 'x', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
      blocked.chat = await refused(A.messaging_domain.send_message(conv.id, 'sneaky', 'k-sneak', [], []));
      blocked.vault = await refused(as(A.vault_domain, staff, () => A.vault_domain.rename_file('file1', 'hacked.pdf')));
      blocked.points = await refused(A.club_points_domain.award_points(CLUB, { User: 'u1' }, 'attendance', 'ev2', 5, 'sneaky', [], [], []));
      blocked.league = await refused(A.mini_league_domain.update_mini_league(league.id, 'Hacked', [], [], 5, 3, 10, [], true));
      blocked.comp = await refused(A.competition_domain.create_competition(CLUB, 'Sneaky Cup', '2026'));
      blocked.media = await refused(A.media_metadata.register_asset(CLUB, 'photo', 'image/jpeg', 'sum2', `clubs/${CLUB}/p2.jpg`, 'club', 99_999_999_999_999n));
      for (const name of ['media_metadata', 'messaging_domain', 'vault_domain', 'club_domain']) {
        const inventory = ok(await A[name].read_club_media_references(CLUB, 0n, []));
        assert.ok(inventory.scanned <= 200n, `${name} metadata page is bounded`);
        assert.equal(ok(await A[name].read_club_media_references(CLUB, 0n, [inventory.revision])).revision, inventory.revision);
        assert.ok('Err' in await A[name].read_club_media_references(CLUB, 0n, [inventory.revision + 1n]), `${name} stale revision denied`);
        assert.ok('Err' in await refused(as(A[name], staff, () => A[name].read_club_media_references(CLUB, 0n, []))), `${name} inventory operator-only`);
      }
      assert.equal(ok(await A.media_metadata.read_club_media_references(CLUB, 0n, [])).references[0].resource_id, asset.id);
      blocked.insights = await refused(A.insights_domain.record_photo_upload(CLUB, 'p2'));
      blocked.sponsor = await refused(A.insights_domain.record_club_sponsor_metric(CLUB, 'sp1', 'impressions', 1, []));
      blocked.notify = await refused(A.notification_queue.enqueue('n2', 'u1', CLUB, 'news', 'Sneaky', 'nk2'));
      blocked.pii = await refused(A.pii_access_control.grant_pii_read_club('child-2', 'name', CLUB));
      blocked.timer = await refused(A.timer_jobs.schedule('job-2', CLUB, 99_999_999_999n, 'tk3'));
      blocked.claim = ok(await A.timer_jobs.claim(100_000_000_000n, 10)).length === 0 ? { Err: 'claim skipped locked club' } : { Ok: 'claimed a locked job' };
      blocked.club = await refused(as(A.club_domain, staff, () => A.club_domain.add_role_grant(governor, CLUB, 'coach', [])));
    }
  } };

  const done = await runTransfer(planTransfer(CLUB, 'a', 'b', 1n), adapter);
  assert.equal(done.phase, 'released'); assert.equal(assignment, 'b');
  assert.deepEqual(saved, ['fenced', 'copied', 'verified', 'cutover', 'released']);
  for (const name of ['media_metadata', 'messaging_domain', 'vault_domain', 'club_domain'])
    assert.ok('Err' in await B[name].read_club_media_references(CLUB, 0n, []), `${name} inventories require a held fence after move`);
  for (const [k, r] of Object.entries(blocked)) assert.ok('Err' in r, `${k} write must be refused while fenced`);

  // Target now serves the club in every domain; bystander club untouched.
  assert.equal(ok(await B.club_domain.get_club_profile(CLUB))[0]?.name, 'Move FC');
  assert.equal(ok(await B.club_domain.get_club_profile('other-club'))[0]?.name, 'Other FC');
  assert.deepEqual((await B.events_domain.list_events([CLUB], [])).map(e => e.id), [ev.id]);
  assert.equal((await B.events_domain.list_events(['other-club'], [])).length, 1);
  assert.deepEqual((await B.messaging_domain.list_messages(conv.id, [])).map(m => m.body), ['hello 0', 'hello 1', 'hello 2']);
  assert.deepEqual(ok(await as(B.vault_domain, staff, () => B.vault_domain.list_files('f1'))).map(f => f.name), ['rules.pdf']);
  assert.deepEqual(ok(await B.club_points_domain.list_rewards(CLUB, [], false)).map(r => r.id), [reward.id]);
  assert.deepEqual((await B.mini_league_domain.list_mini_leagues_by_club(CLUB)).map(l => l.name), ['Under 8s']);
  assert.equal((await A.mini_league_domain.list_mini_leagues_by_club(CLUB)).length, 0);
  assert.ok(ok(await B.club_domain.list_teams(CLUB)).some(t => t.id === team), 'team moved');
  assert.ok(!ok(await A.club_domain.list_teams(CLUB)).some(t => t.id === team), 'team purged from source');
  assert.ok(link.id, 'invite link created');
  assert.deepEqual(ok(await B.competition_domain.list_competitions(CLUB)).map(x => x.id), [comp.id]);
  assert.deepEqual((await B.media_metadata.list_assets(CLUB)).map(x => x.id), [asset.id]);
  assert.equal((await A.media_metadata.list_assets(CLUB)).length, 0);
  const imps = async (X) => Object.fromEntries(ok(await X.insights_domain.get_sponsor_benchmarks(['sp1', 'sp-shared', 'sp-legacy'], '0', '99999999')).map(r => [r.sponsor_id, r.impressions]));
  assert.deepEqual(await imps(B), { sp1: 2, 'sp-shared': 1, 'sp-legacy': 3 }, 'club sponsor numbers moved');
  assert.deepEqual(await imps(A), { sp1: 0, 'sp-shared': 1, 'sp-legacy': 0 }, 'only the other club\'s share stays behind');
  assert.equal((await B.timer_jobs.get_job('job-1'))[0]?.scope, CLUB);
  assert.equal((await A.timer_jobs.get_job('job-1')).length, 0);
  assert.equal((await B.timer_jobs.get_job('job-other'))[0]?.scope, 'other-club');
  // Writable again on the target; source holds nothing.
  ok(await B.messaging_domain.send_message(conv.id, 'after move', 'k-after', [], []));
  ok(await as(B.vault_domain, staff, () => B.vault_domain.rename_file('file1', 'rules-v2.pdf')));
  ok(await B.events_domain.create_event(CLUB, [], 'Match', 'Saturday', 'game', [], [], [], [], 3_000n, 4_000n, [], false, [], []));
  assert.equal(ok(await A.club_domain.get_club_profile(CLUB)).length, 0);
  assert.equal((await A.events_domain.list_events([CLUB], [])).length, 0);
  assert.equal(ok(await as(A.vault_domain, staff, () => A.vault_domain.list_files('f1'))).length, 0);

  // Aborted move: tampering after copy discards the target copy and unlocks the source.
  const t2 = 'club-abort';
  ok(await A.events_domain.create_event(t2, [], 'Keep', 'here', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
  const tamper = { ...base, digest: async (g, club, dom) => {
    const d = await base.digest(g, club, dom); return g === 'b' && dom === 'events_domain' ? { ...d, digest: 'tampered' } : d;
  } };
  const aborted = await runTransfer(planTransfer(t2, 'a', 'b', registryRev), tamper).catch(e => e);
  assert.ok(aborted instanceof Error && /mismatch|digest|verif/i.test(aborted.message), `mismatched copy must abort: ${aborted.message}`);
  assert.equal((await A.events_domain.list_events([t2], [])).length, 1);
  assert.equal((await B.events_domain.list_events([t2], [])).length, 0);
  ok(await A.events_domain.create_event(t2, [], 'Unlocked', 'yes', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
  // Interrupted move: the operator crashes mid-copy; a fresh adapter resumes from
  // the saved phase using the persisted destination and finishes cleanly.
  const t3 = 'club-resume';
  ok(await A.events_domain.create_event(t3, [], 'Resume', 'me', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
  let lastSaved; let crashed = false;
  const crashing = { ...base, save: async t => { await base.save(t); lastSaved = t; },
    importPage: async (g, c, dom, rows, i) => { if (dom === 'messaging_domain' && !crashed) { crashed = true; return new Promise(() => {}); } return base.importPage(g, c, dom, rows, i); } };
  void runTransfer(planTransfer(t3, 'a', 'b', registryRev), crashing);
  while (!crashed) await new Promise(r => setTimeout(r, 50));
  assert.equal(lastSaved.phase, 'fenced'); assert.equal(inflight.get(t3), 'b');
  assert.ok('Err' in await refused(B.events_domain.create_event(t3, [], 'x', 'y', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], [])), 'target stays locked while interrupted');
  const resumed = await runTransfer(lastSaved, base);
  assert.equal(resumed.phase, 'released');
  ok(await B.events_domain.create_event(t3, [], 'Unlocked target', 'yes', 'training', [], [], [], [], 1_000n, 2_000n, [], false, [], []));
  assert.equal((await B.events_domain.list_events([t3], [])).length, 2);
  // Non-governors cannot lock or export.
  assert.ok('Err' in await as(B.events_domain, staff, () => B.events_domain.set_transfer_fence(CLUB, true)));
  assert.ok('Err' in await as(B.messaging_domain, staff, () => B.messaging_domain.export_club_snapshot_page(CLUB, 0n, 10n)));
  console.log('practice move passed: all 12 club canisters moved with locks, verification, cutover, purge, abort and resume after a crash');
} finally { await pic?.tearDown(); await server.stop(); }
