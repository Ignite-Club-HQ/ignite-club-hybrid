/** Manual upgrade-only runner. No creation, funding, wiring, settings changes or opening. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey } from 'node:crypto';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { Secp256k1KeyIdentity } from '@icp-sdk/core/identity/secp256k1';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { createJournalApi } from './media-stage-two-github.mjs';
import { persistGroup2Journal } from '../../scripts/group2-journal.mjs';
import { validateGroup2Inventory, validateUpgradeJournal, wasmHash, verifyUpgradeStatus, upgradeArgs, reconcileUpgradeStep, GROUP2_GOVERNOR } from '../../scripts/group2-upgrade-rules.mjs';

const [action, wasmDirectory, pemFile, reportDirectory] = process.argv.slice(2);
const GROUP = (process.env.GROUP_ID || 'g2').trim();
if (!/^g[1-9][0-9]{0,2}$/.test(GROUP) || GROUP === 'g1') throw new Error('GROUP_ID must be g2 or later');
const NUM = GROUP.slice(1);
const BRANCH = GROUP === 'g2' ? 'group-2-upgrade-receipts' : `group-${NUM}-receipts`;
if (!['check', 'upgrade', 'reload'].includes(action) || !wasmDirectory || !pemFile || !reportDirectory) throw new Error('Usage: upgrade-group2 <check|upgrade|reload> <wasm-directory> <existing-key-file> <report-directory>');
if (action === 'upgrade' && process.env.CONFIRMATION?.trim() !== `UPGRADE GROUP ${NUM}`) throw new Error(`Type UPGRADE GROUP ${NUM} to confirm`);
if (action === 'reload' && process.env.CONFIRMATION?.trim() !== `RELOAD GROUP ${NUM} SETTINGS`) throw new Error(`Type RELOAD GROUP ${NUM} SETTINGS to confirm`);
const root = resolve(import.meta.dirname, '../..');
const provision = JSON.parse(readFileSync(join(root, `deploy/groups/${GROUP}/provision.json`)));
const shared = JSON.parse(readFileSync(join(root, 'deploy/mainnet/.icp/data/mappings/ic.ids.json')));
const services = validateGroup2Inventory(provision, shared, GROUP);
const jwk = createPrivateKey(readFileSync(pemFile, 'utf8')).export({ format: 'jwk' });
if (!jwk.d) throw new Error('Existing signing key required');
const secret = new Uint8Array(Buffer.from(jwk.d, 'base64url'));
const identity = jwk.crv === 'secp256k1' ? Secp256k1KeyIdentity.fromSecretKey(secret) : jwk.crv === 'Ed25519' ? Ed25519KeyIdentity.fromSecretKey(secret) : null;
if (!identity || identity.getPrincipal().toText() !== GROUP2_GOVERNOR) throw new Error('Original deployed governor identity required');
mkdirSync(reportDirectory, { recursive: true });
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const anonymous = await HttpAgent.create({ host: 'https://icp-api.io' });
const managementIdl = () => IDL.Service({ canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
  status: IDL.Variant({ running: IDL.Null, stopped: IDL.Null, stopping: IDL.Null }), module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
  settings: IDL.Record({ controllers: IDL.Vec(IDL.Principal), environment_variables: IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text })) }),
})], []) });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const observe = async service => {
  const principal = Principal.fromText(service.canisterId);
  const management = Actor.createActor(managementIdl, { agent, canisterId: Principal.managementCanister(), effectiveCanisterId: principal });
  const s = await management.canister_status({ canister_id: principal });
  const certified = await CanisterStatus.request({ agent, canisterId: principal, paths: ['subnet'] });
  const subnet = certified.get('subnet');
  const health = Actor.createActor(() => IDL.Service({ cycles_balance: IDL.Func([], [IDL.Nat], ['query']), memory_stats: IDL.Func([], [IDL.Record({ heap_bytes: IDL.Nat, stable_bytes: IDL.Nat })], ['query']) }), { agent: anonymous, canisterId: principal });
  const cycles = await health.cycles_balance();
  const memory = await health.memory_stats();
  const environment = s.settings.environment_variables;
  const result = { moduleHash: s.module_hash[0] ? Buffer.from(s.module_hash[0]).toString('hex') : null,
    controllers: s.settings.controllers.map(p => p.toText()), running: 'running' in s.status, cycles,
    subnetId: typeof subnet?.subnetId === 'string' ? subnet.subnetId : '', environment };
  verifyUpgradeStatus(service, result, GROUP2_GOVERNOR);
  return { ...result, settingsHash: hash([...environment].sort((a,b) => a.name.localeCompare(b.name))), heapBytes: String(memory.heap_bytes), stableBytes: String(memory.stable_bytes) };
};
const router = Actor.createActor(routerIdl, { agent, canisterId: shared.shard_router });
const closed = async () => {
  const reply = await router.read_group_registry('ic');
  if ('Err' in reply) throw new Error(`Shared router upgrade/configuration is required before ${GROUP} upgrade`);
  const group = reply.Ok.groups.find(g => g.id === GROUP);
  if (group?.accepting) throw new Error(`Group ${NUM} must remain closed`);
  if (group && (group.domains.filter(d => d.domain !== 'secret_workload_identity').length !== 12 ||
    services.filter(s => s.name !== 'media_blob_store').some(s => !group.domains.some(d => d.domain === s.name && d.canister.toText() === s.canisterId)) ||
    group.photo_store[0]?.toText() !== provision.dedicatedBlobStore.canisterId)) throw new Error(`Registered ${GROUP} inventory differs`);
  const opening = await router.read_owner_test_deletion_required('ic');
  if ('Err' in opening || opening.Ok) throw new Error(`Group ${NUM} owner opening already exists or cannot be verified; this initial closed upgrade refuses`);
  return String(reply.Ok.revision);
};
const revision = await closed();
const plans = services.map(s => {
  const paths = ['.wasm.gz', '.wasm'].map(ext => join(wasmDirectory, s.name + ext));
  let file;
  for (const path of paths) { try { readFileSync(path); file = path; break; } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  if (!file) throw new Error(`Missing staged artifact: ${s.name}`);
  return { ...s, file, newHash: wasmHash(readFileSync(file)) };
});
const publicObservations = [];
for (const s of plans) { const o = await observe(s); publicObservations.push({ ...s, file: undefined, oldHash: o.moduleHash, settingsHash: o.settingsHash,
  cycles: String(o.cycles), heapBytes: o.heapBytes, stableBytes: o.stableBytes }); }
const mappingFile = join(reportDirectory, `${GROUP}-mapping.json`);
const keyFile = join(reportDirectory, 'original-photo-key.json');
writeFileSync(mappingFile, JSON.stringify({ pii_access_control: provision.canisters.pii_access_control }));
const keyGate = phase => {
  const result = spawnSync(process.execPath, [join(root, 'frontend/scripts/media-key-deploy-preflight.mjs'), phase, mappingFile, keyFile, 'mainnet', 'ic'], {
    env: { ...process.env, GOVERNOR: GROUP2_GOVERNOR, DEPLOYER_PEM_FILE: pemFile }, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Original Group ${NUM} photo-key attestation/preservation failed; no replay`);
};
const report = { groupId: GROUP, revision, release: process.env.GITHUB_SHA, authorizesOpening: false, services: publicObservations };
writeFileSync(join(reportDirectory, 'upgrade-report.json'), JSON.stringify(report, null, 2));
if (action === 'check') {
  keyGate('before');
  console.log(`All thirteen ${GROUP} services checked; no upgrades or opening performed.`);
} else if (action === 'upgrade') {
  const repo = process.env.GITHUB_REPOSITORY, release = process.env.GITHUB_SHA;
  if (!repo || !release || !/^[a-f0-9]{40}$/.test(release)) throw new Error('GitHub release binding required');
  const api = createJournalApi(repo, JSON.stringify);
  const branch = BRANCH;
  const refs = api(`git/matching-refs/heads/${branch}`);
  if (!refs.some(r => r.ref === `refs/heads/${branch}`)) {
    const metadata = api(''); const base = api(`git/ref/heads/${metadata.default_branch}`);
    api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: base.object.sha });
  }
  const directory = api(`contents/deploy/groups/${GROUP}?ref=${branch}`);
  const exists = directory.some(e => e.name === 'upgrade-progress.json');
  const path = `contents/deploy/groups/${GROUP}/upgrade-progress.json`;
  let stored = exists ? api(`${path}?ref=${branch}`) : null;
  let journal = stored ? JSON.parse(Buffer.from(stored.content, 'base64').toString()) : null;
  const binding = { release, governor: GROUP2_GOVERNOR, provisionHash: hash(provision), inventory: plans.map(({ file, ...p }) => p) };
  if (journal?.complete === true && JSON.stringify(journal.binding) !== JSON.stringify(binding)) {
    throw new Error(`Group ${NUM} was already upgraded by an earlier release, so nothing was changed. To make saved settings take effect, choose action "reload" with confirmation RELOAD GROUP ${NUM} SETTINGS`);
  }
  if (journal) validateUpgradeJournal(journal, binding);
  const persist = () => {
    stored = persistGroup2Journal(api, path, branch, stored, journal, 'upgrade');
    writeFileSync(join(reportDirectory, 'upgrade-progress.json'), JSON.stringify(journal, null, 2));
  };
  if (!journal) {
    keyGate('before');
    journal = { binding, routerRevision: revision, keyReceipt: JSON.parse(readFileSync(keyFile)), steps: publicObservations.map(s => ({ ...s, phase: 'ready' })), complete: false };
    persist(); // All original evidence/key and release binding precede any upgrade.
  } else writeFileSync(keyFile, JSON.stringify(journal.keyReceipt));
  if (journal.routerRevision !== revision) throw new Error('Router changed since upgrade approval');
  keyGate('after');
  for (const plan of plans) {
    if (await closed() !== revision) throw new Error('Registry changed; stop upgrade');
    const index = journal.steps.findIndex(s => s.name === plan.name);
    if (index < 0) throw new Error('Missing journal service');
    let step = journal.steps[index]; const before = await observe(plan);
    if (before.settingsHash !== step.settingsHash) throw new Error(`Settings changed: ${plan.name}`);
    step = reconcileUpgradeStep(step, before.moduleHash); journal.steps[index] = step;
    if (step.phase === 'complete' || step.oldHash === step.newHash) {
      step.phase = 'complete'; persist(); continue;
    }
    step.phase = 'pending'; persist();
    console.log(`Upgrading existing ${GROUP} ${plan.name}`);
    const result = spawnSync('icp', upgradeArgs(plan, plan.file, GROUP2_GOVERNOR), { cwd: reportDirectory, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Upgrade failed or response unknown: ${plan.name}; pending intent retained`);
    const after = await observe(plan);
    verifyUpgradeStatus(plan, after, GROUP2_GOVERNOR, plan.newHash);
    if (after.settingsHash !== step.settingsHash) throw new Error('Environment settings changed during upgrade');
    if (plan.name === 'pii_access_control') keyGate('after');
    step.phase = 'complete'; persist();
  }
  keyGate('after');
  for (const plan of plans) verifyUpgradeStatus(plan, await observe(plan), GROUP2_GOVERNOR, plan.newHash);
  if (await closed() !== revision) throw new Error('Router changed during final verification');
  journal.complete = true; persist();
  console.log(`Thirteen Group ${NUM} modules verified; settings and photo key preserved. Group ${NUM} remains closed.`);
}
if (action === 'reload') {
  // Same-module reload: Motoko services read their service settings into
  // transient values only at install/upgrade, so settings written after the
  // last upgrade stay invisible until the identical module is reinstalled in
  // upgrade mode. Refuses unless every staged artifact equals the live module,
  // so no code, fingerprint, memory or setting changes. Replaying a pending
  // step is safe because reinstalling the identical module is idempotent.
  for (const p of plans) {
    const live = publicObservations.find(o => o.name === p.name)?.oldHash;
    if (live !== p.newHash) throw new Error(`Reload refused: the staged ${p.name} build differs from the live module (live ${live}, staged ${p.newHash}); reload never changes code`);
  }
  const repo = process.env.GITHUB_REPOSITORY, release = process.env.GITHUB_SHA;
  if (!repo || !release || !/^[a-f0-9]{40}$/.test(release)) throw new Error('GitHub release binding required');
  const api = createJournalApi(repo, JSON.stringify);
  const branch = BRANCH;
  const refs = api(`git/matching-refs/heads/${branch}`);
  if (!refs.some(r => r.ref === `refs/heads/${branch}`)) {
    const metadata = api(''); const base = api(`git/ref/heads/${metadata.default_branch}`);
    api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: base.object.sha });
  }
  const name = 'reload-progress.json';
  const path = `contents/deploy/groups/${GROUP}/${name}`;
  const directory = api(`contents/deploy/groups/${GROUP}?ref=${branch}`);
  let stored = directory.some(e => e.name === name) ? api(`${path}?ref=${branch}`) : null;
  let journal = stored ? JSON.parse(Buffer.from(stored.content, 'base64').toString()) : null;
  const binding = { kind: 'reload', governor: GROUP2_GOVERNOR, provisionHash: hash(provision), inventory: plans.map(({ file, ...p }) => p) };
  const persist = () => {
    stored = persistGroup2Journal(api, path, branch, stored, journal, 'reload');
    writeFileSync(join(reportDirectory, name), JSON.stringify(journal, null, 2));
  };
  if (journal && !journal.complete && JSON.stringify(journal.binding) !== JSON.stringify(binding)) throw new Error('An unfinished reload for a different inventory exists; review it before reloading');
  if (!journal || journal.complete) {
    keyGate('before');
    journal = { binding, release, routerRevision: revision, keyReceipt: JSON.parse(readFileSync(keyFile)),
      steps: publicObservations.map(s => ({ name: s.name, canisterId: s.canisterId, moduleHash: s.oldHash, settingsHash: s.settingsHash, phase: 'ready' })), complete: false };
    persist();
  } else writeFileSync(keyFile, JSON.stringify(journal.keyReceipt));
  if (journal.routerRevision !== revision) throw new Error('Router changed since reload intent');
  keyGate('after');
  for (const plan of plans) {
    if (await closed() !== revision) throw new Error('Registry changed; stop reload');
    const step = journal.steps.find(s => s.name === plan.name);
    if (!step) throw new Error('Missing reload journal service');
    if (step.phase === 'complete') continue;
    const before = await observe(plan);
    if (before.moduleHash !== plan.newHash) throw new Error(`Live module changed: ${plan.name}`);
    if (before.settingsHash !== step.settingsHash) throw new Error(`Settings changed since reload intent: ${plan.name}`);
    step.phase = 'pending'; persist();
    console.log(`Reloading ${GROUP} ${plan.name} (same module)`);
    const result = spawnSync('icp', upgradeArgs(plan, plan.file, GROUP2_GOVERNOR), { cwd: reportDirectory, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Reload failed or response unknown: ${plan.name}; rerun reload (same module, safe to repeat)`);
    const after = await observe(plan);
    verifyUpgradeStatus(plan, after, GROUP2_GOVERNOR, plan.newHash);
    if (after.settingsHash !== step.settingsHash) throw new Error('Environment settings changed during reload');
    if (plan.name === 'pii_access_control') keyGate('after');
    step.phase = 'complete'; persist();
  }
  keyGate('after');
  if (await closed() !== revision) throw new Error('Router changed during final verification');
  journal.complete = true; persist();
  console.log(`Thirteen Group ${NUM} services reloaded with identical modules; settings now active, fingerprints unchanged. Group ${NUM} remains closed.`);
}
