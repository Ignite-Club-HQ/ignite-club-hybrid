// Real identity write-coordinator orchestration across two disposable groups.
// Drives begin/advance/close through actual inter-canister calls, including an
// identity upgrade mid-Opening and a stopped sink during Releasing. No
// production transport or approvals.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as placementIdl } from '../src/lab/bindings/placement_registry/declarations/placement_registry.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as messagingIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as competitionIdl } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
import { idlFactory as leagueIdl } from '../src/lab/bindings/mini_league_domain/declarations/mini_league_domain.did.js';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as blobIdl } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import {createPrivateNameCoordinatorAdapter,createPrivateNameProfileAdapter,createPrivateNamePiiAdapter} from '../../scripts/private-name-canister-adapters.mjs';
import {prepareInventoriedPrivateNameArtifact} from '../../scripts/private-name-club-inventory.mjs';
import {savePrivateNameArtifact,readPrivateNameArtifact} from '../../scripts/private-name-plan-artifact.mjs';
import {openPreparedExecutionJournal} from '../../scripts/private-name-execution-journal.mjs';
import {executePreparedPrivateNamePlan} from '../../scripts/private-name-prepared-execution.mjs';
import {encryptName,encryptClubName} from '../../scripts/convert-private-names.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareSignedNameApproval,saveSignedNameApproval,readSavedNameApproval} from '../../scripts/private-name-saved-approval.mjs';
import {generateKeyPairSync,sign} from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1), outsider = p(2);
const ok = r => { assert.ok('Ok' in r, JSON.stringify(r, (_, v) => typeof v === 'bigint' ? String(v) : v)); return r.Ok; };
const denied = async fn => { let d = false; try { const r = await fn(); d = !!r && 'Err' in r; } catch { d = true; } assert.ok(d, 'Must fail closed'); };
const phaseOf = w => Object.keys(w.phase)[0];
const motokoWasm = d => resolve(root, `backend/${d}/.mops/.build/${d}.wasm`);
const rustWasm = d => resolve(root, `target/wasm32-unknown-unknown/release/${d}.wasm`);
const domains = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain',
  'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs', 'secret_workload_identity'];

const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN || '/root/.cache/mops/pocket-ic/15.0.0/pocket-ic' });
let pic;
try {
  pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
  const init = IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]);
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: rustWasm('identity_access'), sender: governor, controllers: [governor], arg: init });
  identity.actor.setPrincipal(governor); ok(await identity.actor.register_account());
  ok(await identity.actor.set_profile('Governor', []));
  // A plaintext-named account awaiting conversion, created before the gate closes.
  identity.actor.setPrincipal(outsider);
  const convertee = ok(await identity.actor.register_account());
  ok(await identity.actor.set_profile('Paul Cranwell', []));
  identity.actor.setPrincipal(governor);
  await pic.updateCanisterSettings({ canisterId: identity.canisterId, sender: governor, environmentVariables:
    [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }] });
  await pic.upgradeCanister({ canisterId: identity.canisterId, wasm: rustWasm('identity_access'), sender: governor, arg: init });
  const topologyEnv = [{ name: 'IGNITE_PRIVATE_NAME_WRITER_REHEARSAL', value: '1' }, { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: identity.canisterId.toText() }];
  // Router registers the group inventory before its writes close.
  const router = await pic.setupCanister({ idlFactory: routerIdl, wasm: rustWasm('shard_router'), sender: governor, controllers: [governor], arg: init });
  const placement = await pic.setupCanister({ idlFactory: placementIdl, wasm: rustWasm('placement_registry'), sender: governor, controllers: [governor], arg: init, environmentVariables: topologyEnv });
  router.actor.setPrincipal(governor);
  const subnet = await pic.getCanisterSubnetId(router.canisterId); assert.ok(subnet);

  const groups = [], supplemental = [], mediaStores = [];
  for (let n = 0; n < 2; n++) {
    const group = {};
    const env = [
      { name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' },
      { name: 'IGNITE_PRIVATE_NAME_WRITER_REHEARSAL', value: '1' },
      { name: 'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL', value: '1' },
      { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: identity.canisterId.toText() },
      { name: 'IGNITE_PRIVATE_PROFILE_IDENTITY', value: identity.canisterId.toText() },
      { name: 'VETKD_KEY_NAME', value: 'key_1' }];
    for (const [d, idlFactory] of [['club_domain', clubIdl], ['messaging_domain', messagingIdl], ['competition_domain', competitionIdl], ['mini_league_domain', leagueIdl], ['pii_access_control', piiIdl]]) {
      // Clubs register their media store before the writer window closes writes.
      const service = await pic.setupCanister({ idlFactory, wasm: motokoWasm(d), sender: governor, controllers: [governor],
        arg: IDL.encode([IDL.Principal], [governor]), environmentVariables: d === 'club_domain' ? env.filter(e => e.name !== 'IGNITE_PRIVATE_NAME_WRITER_REHEARSAL') : env });
      service.actor.setPrincipal(governor); group[d] = service;
    }
    const store = await pic.setupCanister({ idlFactory: blobIdl, wasm: resolve(root, 'backend/media_blob_store/main.wasm'), sender: governor, controllers: [governor],
      environmentVariables: [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }, { name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' },
        { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: identity.canisterId.toText() }], arg: IDL.encode([IDL.Principal], [governor]) });
    ok(await group.club_domain.actor.register_media_quota_store(store.canisterId));
    await pic.updateCanisterSettings({canisterId:group.club_domain.canisterId,sender:governor,environmentVariables:[]});
    await pic.upgradeCanister({canisterId:group.club_domain.canisterId,wasm:motokoWasm('club_domain'),sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
    ok(await group.club_domain.actor.create_club(`club-${n}`,'Conversion club','privacy',[],[]));
    ok(await group.club_domain.actor.replace_acl(1n,{clubs:[`club-${n}`],teams:[],children:[],guardians:[],exclusions:[],roles:[governor,outsider].map(user=>({user,role:'member',club:[`club-${n}`],team:[]}))}));
    await pic.updateCanisterSettings({ canisterId: group.club_domain.canisterId, sender: governor, environmentVariables: env });
    await pic.upgradeCanister({ canisterId: group.club_domain.canisterId, wasm: motokoWasm('club_domain'), sender: governor,
      arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    group.club_domain.actor.setPrincipal(governor);
    mediaStores.push(store);
    const mapped = domains.map((domain, i) => ({ domain, canister: group[domain] ? group[domain].canisterId : domain === 'secret_workload_identity' ? p(200) : p(10 + n * 20 + i) }));
    let rev = await router.actor.version();
    rev = ok(await router.actor.register_group({ id: `g${n}`, target_alias: 'local', domains: mapped, accepting: false, max_clubs: 100,
      assigned_clubs: 0, heap_budget_bytes: 1_000_000n, heap_bytes: 0n, min_cycles: 1n, cycles: 0n, observed_at_ns: 0n, photo_store: [] }, rev));
    ok(await router.actor.register_group_placement({ group_id: `g${n}`, deployment_id: 'isolated-replica', deployment_revision: 1n,
      host: 'https://isolated.invalid', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet],
      additional_subnets_enabled: false, domains: mapped.map(d => ({ ...d, subnet })) }, rev));
    supplemental.push({ group_id: `g${n}`, domain: 'media_blob_store', canister: store.canisterId, subnet });
    groups.push(group);
  }
  supplemental.push({ group_id: 'g0', domain: 'identity_access', canister: identity.canisterId, subnet });
  supplemental.push({ group_id: 'g0', domain: 'placement_registry', canister: placement.canisterId, subnet });

  const actor = identity.actor;
  // Group inventory is pinned; router topology writes now close.
  await pic.updateCanisterSettings({ canisterId: router.canisterId, sender: governor, environmentVariables: topologyEnv });
  ok(await actor.set_club_authorities(groups.map(g => g.club_domain.canisterId)));
  ok(await actor.set_service_authorities([
    ...groups.flatMap(g => [g.club_domain.canisterId, g.messaging_domain.canisterId, g.competition_domain.canisterId, g.mini_league_domain.canisterId, g.pii_access_control.canisterId]),
    ...mediaStores.map(s => s.canisterId)]));
  let binding = { registry: router.canisterId, registry_revision: await router.actor.version(), target_alias: 'local',
    deployment_id: 'isolated-replica', deployment_revision: 1n, host: 'https://isolated.invalid', network_kind: 'public_mainnet' };
  const revision = async () => ok(await actor.read_removal_history_manifest()).revision;
  ok(await actor.set_group_inventory_binding(binding, await revision()));
  ok(await actor.set_removal_supplemental_inventory(supplemental, await revision()));
  // History reads take a writer lease once the gate closes; capture the exact
  // pinned revision now. Upgrades and window phases do not bump it.
  const pinnedRevision = await revision();

  // Inventory pinned; now close identity's own writes behind the writer gate.
  // Settings alone activate the runtime gate; an upgrade would bump the pinned
  // removal-history revision through post_upgrade.
  await pic.updateCanisterSettings({ canisterId: identity.canisterId, sender: governor, environmentVariables:
    [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }, { name: 'IGNITE_PRIVATE_NAME_WRITER_REHEARSAL', value: '1' },
     { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: identity.canisterId.toText() }] });
  actor.setPrincipal(governor);
  await denied(() => actor.read_removal_history_manifest());

  // Closed gates: outsider, stale history and writes before any window.
  actor.setPrincipal(outsider); await denied(() => actor.begin_private_name_write_window('go-live', pinnedRevision)); actor.setPrincipal(governor);
  await denied(() => actor.begin_private_name_write_window('go-live', pinnedRevision + 1n));
  await denied(() => groups[0].club_domain.actor.set_identity_access_canister(outsider));

  // Begin: fences every original PII sink before any writer opens.
  let w = ok(await actor.begin_private_name_write_window('go-live', pinnedRevision));
  assert.equal(phaseOf(w), 'Fencing');
  assert.equal(w.sinks.length, 2); assert.equal(w.writers.length, 11);
  await denied(() => actor.begin_private_name_write_window('concurrent', pinnedRevision));
  for (const sink of w.sinks) w = ok(await actor.advance_private_name_write_window('go-live', sink));
  assert.equal(phaseOf(w), 'Opening');

  // Interrupt mid-Opening: upgrade the coordinator; the durable journal resumes.
  const half = Math.floor(w.writers.length / 2);
  for (const target of w.writers.slice(0, half)) w = ok(await actor.advance_private_name_write_window('go-live', target));
  await pic.upgradeCanister({ canisterId: identity.canisterId, wasm: rustWasm('identity_access'), sender: governor });
  actor.setPrincipal(governor);
  w = ok(await actor.read_private_name_write_window('go-live'));
  assert.equal(phaseOf(w), 'Opening'); assert.equal(w.opened.length, half);
  for (const target of w.writers.slice(half)) w = ok(await actor.advance_private_name_write_window('go-live', target));
  assert.equal(phaseOf(w), 'Writing');

  // Authorized writes proceed inside the window; topology stays closed.
  ok(await groups[0].club_domain.actor.set_identity_access_canister(identity.canisterId));
  router.actor.setPrincipal(governor);
  await denied(() => router.actor.set_website_default_club_domain(outsider));

  // Prepare the full real account/club inventory in this rehearsal window.
  // Exclusion here is harness-owned: no other writers run in this disposable
  // replica. The ordinary writer window itself is NOT production exclusion.
  const sink0pre = groups[0].pii_access_control;
  const { DerivedPublicKey, IbeCiphertext,EncryptedVetKey,TransportSecretKey } = await import('@icp-sdk/vetkeys');
  const { createHash } = await import('node:crypto');
  let harnessExclusive=true;
  const profileAdapter=createPrivateNameProfileAdapter(actor,{assertFence:async()=>harnessExclusive});
  const profiles=await profileAdapter.listProfiles();assert.equal(profiles.length,2);
  assert.ok(profiles.every(r=>r.principals.length===1),'This fixture covers single-alias accounts only');
  assert.deepEqual(profiles.map(r=>r.principals[0]).sort(),[governor.toText(),outsider.toText()].sort());
  const piiBySink=new Map(groups.map(g=>[g.pii_access_control.canisterId.toText(),createPrivateNamePiiAdapter(g.pii_access_control.actor,Principal)]));
  const sinks=await Promise.all([...piiBySink].map(async([id,pii])=>({id,publicKey:await pii.publicKey()})));
  sinks.sort((a,b)=>a.id.localeCompare(b.id));
  const sources=groups.map((g,n)=>({group:`g${n}`,canisterId:g.club_domain.canisterId.toText()}));
  const actors=new Map(groups.map(g=>[g.club_domain.canisterId.toText(),{
    read_membership_source_page:c=>g.club_domain.actor.read_membership_source_page(c),
    read_membership_discovery_status:()=>g.club_domain.actor.read_membership_discovery_status(),
    read_has_club_membership:(s,c)=>g.club_domain.actor.read_has_club_membership(Principal.fromText(s),c),
  }]));
  const {artifact,inventory}=await prepareInventoriedPrivateNameArtifact({identityId:identity.canisterId.toText(),operator:governor.toText(),deploymentHash:createHash('sha256').update('disposable-two-group-replica').digest('hex'),historyRevision:String(pinnedRevision+1n),sinks,sources,accounts:profiles.map(r=>({accountId:r.account_id,subject:r.principals[0],name:r.display_name,sink:sink0pre.canisterId.toText()}))},{actors,assertFence:async()=>harnessExclusive,encryptName,encryptClubName});
  assert.equal(inventory.body.sourceReceipts.length,2);
  assert.deepEqual(inventory.body.rows.find(r=>r.accountId===convertee.id).clubs,['club-0','club-1']);
  const directory=mkdtempSync(join(tmpdir(),'real-name-conversion-'));
  savePrivateNameArtifact(join(directory,'plan'),artifact,artifact.hash);
  actor.setPrincipal(outsider); await denied(() => actor.list_profiles_for_conversion([], 10)); actor.setPrincipal(governor);

  // Close, seal every writer, then release sinks with a stopped-sink hold.
  w = ok(await actor.close_private_name_write_window('go-live'));
  assert.equal(phaseOf(w), 'Closing');
  for (const target of w.writers) w = ok(await actor.advance_private_name_write_window('go-live', target));
  assert.equal(phaseOf(w), 'Releasing');
  // Every writer is sealed and drained before any sink releases.
  await denied(() => groups[0].club_domain.actor.set_identity_access_canister(outsider));
  const sink0 = groups.map(g => g.pii_access_control).find(s => s.canisterId.toText() === w.sinks[0].toText());
  await pic.stopCanister({ canisterId: sink0.canisterId, sender: governor });
  const signature = new Map(identityIdl({ IDL })._fields).get('advance_private_name_write_window'); assert.ok(signature);
  const held = await pic.client.submitCall({ canisterId: identity.canisterId, sender: governor, method: 'advance_private_name_write_window',
    payload: new Uint8Array(IDL.encode(signature.argTypes, ['go-live', w.sinks[0]])) });
  await pic.tick(3);
  await pic.startCanister({ canisterId: sink0.canisterId, sender: governor });
  const heldReply = IDL.decode(signature.retTypes, (await pic.client.awaitCall(held)).body)[0];
  // The stopped sink's outcome is unknown: the window is retained, not guessed.
  assert.ok('Err' in heldReply, 'Unknown sink outcome must retain the window');
  w = ok(await actor.read_private_name_write_window('go-live'));
  assert.equal(phaseOf(w), 'Releasing'); assert.equal(w.completed.length, 0);
  // Recovery: completion is an idempotent journaled intent, so retry resolves it.
  w = ok(await actor.advance_private_name_write_window('go-live', w.sinks[0]));
  assert.equal(w.completed.length, 1);
  w = ok(await actor.advance_private_name_write_window('go-live', w.sinks[1]));
  assert.equal(phaseOf(w), 'Done');

  // Final receipts: both sinks completed with advanced epochs; reopen refused.
  for (const g of groups) {
    g.pii_access_control.actor.setPrincipal(identity.canisterId);
    const fence = ok(await g.pii_access_control.actor.read_private_name_release_fence(w.request));
    assert.equal(fence.completed, true); assert.ok(fence.release_epoch > 1n);
    await denied(() => g.pii_access_control.actor.open_private_name_writer_window(w.request));
  }
  // Full saved-plan execution starts a FRESH real coordinator operation.
  // Lose a reply after a real club ciphertext commit, close the local handle,
  // reopen the immutable artifact/receipts and recover without a repeated write.
  for(const g of groups)g.pii_access_control.actor.setPrincipal(governor);
  let lockHeld=false,journal;
  const lock={enter:async()=>{lockHeld=true;return true;},assertHeld:async()=>lockHeld,complete:async()=>{lockHeld=false;}};
  const openJournal=()=>openPreparedExecutionJournal(join(directory,'receipts'),{artifact,expectedHash:artifact.hash,assertHeld:()=>harnessExclusive});
  journal=openJournal();
  const originalPii=piiBySink.get(sink0pre.canisterId.toText());const writeClub=originalPii.writeClub;
  let attempts=0,lost=true;
  originalPii.writeClub=async(...args)=>{attempts++;const result=await writeClub(...args);if(lost){lost=false;throw Error('Injected lost committed club reply');}return result;};
  const decryptSaved=async(row,sink)=>{
    // Fixture-only plaintext comparison: records do not exist before initial
    // conversion. Actual SDK decryption is independently asserted below.
    const original=profiles.find(p=>p.account_id===row.accountId);assert.ok(original);
    return original.display_name;
  };
  const deps={journal,executionLock:lock,assertExecution:async()=>harnessExclusive,piiBySink,identity:profileAdapter,coordinator:createPrivateNameCoordinatorAdapter(actor,Principal),readBinding:async()=>({...artifact.body,sinks:await Promise.all(sinks.map(async s=>({id:s.id,publicKey:await piiBySink.get(s.id).publicKey()})))}),decryptName:decryptSaved};
  // Disposable signing identity proves envelope binding/reopen, NOT Paul's
  // real approval, protected signer configuration or production authorization.
  const approvalKeys=generateKeyPairSync('ed25519'),approvalPublicKey=approvalKeys.publicKey.export({type:'spki',format:'pem'});
  const approvalBinding=action=>({artifact,expectedHash:artifact.hash,approver:'replica-owner',approvalId:`replica-${action}-event`,action,publicKey:approvalPublicKey});
  const saveApproval=async action=>{
    const binding=approvalBinding(action),envelope=await prepareSignedNameApproval(binding,{publicKey:approvalPublicKey,signApprovedEvent:async(_body,bytes)=>sign(null,bytes,approvalKeys.privateKey)});
    saveSignedNameApproval(join(directory,`approval-${action}`),envelope,binding);
    return readSavedNameApproval(join(directory,`approval-${action}`),binding);
  };
  const request={artifact,expectedHash:artifact.hash,approval:await saveApproval('convert')};
  try {
    await assert.rejects(executePreparedPrivateNamePlan(request,deps),/Injected lost committed club reply/);
    const operationId=`club-name-conversion-${artifact.hash}`;
    assert.equal((await deps.coordinator.read(operationId)).phase,'Writing');assert.equal(lockHeld,true);
    journal.close();const savedBody=readPrivateNameArtifact(join(directory,'plan'),artifact.hash);
    assert.deepEqual(savedBody,artifact.body);journal=openJournal();deps.journal=journal;
    request.approval=await saveApproval('recover');
    const report=await executePreparedPrivateNamePlan(request,deps);
    assert.equal(report.phase,'Done');assert.equal(report.converted,2);assert.equal(attempts,4);assert.equal(lockHeld,false);
    const finalProfiles=await profileAdapter.listProfiles();assert.ok(finalProfiles.every(p=>p.display_name.startsWith('pii-display-name:v1:')));
    // Real original-key SDK decryption verifies each saved plaintext; club
    // ciphertext is byte-verified by the driver before any reference publishes.
    for(const row of artifact.body.rows){
      sink0pre.actor.setPrincipal(Principal.fromText(row.subject));
      const transport=TransportSecretKey.random(),input=new TextEncoder().encode(`${row.subject}\u001fdisplay_name`);
      const keys=ok(await sink0pre.actor.get_encrypted_pii_vetkeys_batch([row.subject],'display_name',transport.publicKeyBytes()));
      const key=EncryptedVetKey.deserialize(Uint8Array.from(keys[0][0])).decryptAndVerify(transport,DerivedPublicKey.deserialize(Uint8Array.from(sinks.find(s=>s.id===row.sink).publicKey)),input);
      assert.equal(new TextDecoder().decode(IbeCiphertext.deserialize(Uint8Array.from(row.ciphertext)).decrypt(key)),profiles.find(p=>p.account_id===row.accountId).display_name);
    }
    sink0pre.actor.setPrincipal(governor);
    console.log('PASS: real two-group single-alias fixture profile/membership inventory, immutable randomized ciphertext, signed fixture approvals, fresh prepared conversion, disk-reopened committed-reply recovery without replay, exact original/club/profile readbacks and post-conversion SDK decryption; 2 sinks/11 writers plus upgrade/stopped-sink recovery. Production account completeness, plaintext reconciliation, exclusivity and protected approval transport remain blocked.');
  } finally {journal?.close();harnessExclusive=false;rmSync(directory,{recursive:true,force:true});}
} finally { if (pic) await pic.tearDown(); await server.stop(); }
