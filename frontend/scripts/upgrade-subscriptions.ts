/** Existing four-canister upgrade only. No creation, wiring, funding or opening. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { groupApprovalConfiguration } from '../src/live/groupApproval';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { createJournalApi } from './media-stage-two-github.mjs';
import { persistGroup2Journal } from '../../scripts/group2-journal.mjs';
import { GROUP2_GOVERNOR, validateGroup2Inventory, verifyUpgradeStatus, upgradeArgs, wasmHash } from '../../scripts/group2-upgrade-rules.mjs';
import { digest, validateRequest, validateTargets, validateRegisteredPair, validateJournal, executeUpgrades } from '../../scripts/subscription-upgrade-policy.mjs';

const [action, artifacts, pem, directory] = process.argv.slice(2);
validateRequest(action, process.env.CONFIRMATION);
if (!artifacts || !pem || !directory) throw new Error('Artifacts, existing key and report directory required');
const root = new URL('../../', import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const shared = json('deploy/mainnet/.icp/data/mappings/ic.ids.json');
const provision = json('deploy/groups/g2/provision.json');
const approval = json('deploy/groups/g2/general-opening.json');
if (shared.shard_router !== 'jcdfe-vqaaa-aaaal-qxloq-cai' || shared.identity_access !== 'mq2sj-fiaaa-aaaal-qxlqa-cai' ||
    shared.club_domain !== 'mzzzv-taaaa-aaaal-qxlrq-cai' || shared.media_blob_store !== 'jlaoy-dyaaa-aaaal-qxlpa-cai' ||
    shared.pii_access_control !== 'iui5p-aaaaa-aaaal-qxllq-cai') throw new Error('Pinned original mainnet mappings required');
const g2 = validateGroup2Inventory(provision, shared);
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GROUP2_GOVERNOR) throw new Error('Original governor identity required');
mkdirSync(directory, { recursive: true });
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const router = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: shared.shard_router });
const registry = () => readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page('mainnet', rev, cursor, limit));
const initial = await registry();
if (initial.configurationRevision === undefined) throw new Error('Configuration-bound router required');
const configuration = groupApprovalConfiguration(initial.groups, initial.placements);
const liveG2 = initial.groups.find(g => g.id === 'g2');
const placement = initial.placements.find(p => p.group_id === 'g2');
if (!liveG2 || !placement || placement.deployment_id !== 'mainnet' || placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet' ||
    liveG2.photo_store[0]?.toText() !== provision.dedicatedBlobStore.canisterId ||
    g2.filter(s => s.name !== 'media_blob_store').some(s => !liveG2.domains.some(d => d.domain === s.name && d.canister.toText() === s.canisterId))) throw new Error('Registered Group 2 inventory differs');
const primarySubnet = 'e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe';
const targets = ['g1', 'g2'].flatMap(groupId => ['club_domain', 'media_blob_store'].map(name => {
  const s = g2.find(s => s.name === name);
  if (!s) throw new Error('Missing Group 2 service');
  const file = resolve(artifacts, name);
  return { groupId, name, canisterId: groupId === 'g1' ? shared[name] : s.canisterId,
    subnetId: groupId === 'g1' ? primarySubnet : s.subnetId, newHash: wasmHash(readFileSync(file)) };
}));
validateTargets(targets);
for (const groupId of ['g1', 'g2']) validateRegisteredPair(groupId, targets, initial.groups, initial.placements);
type Target = typeof targets[number];
const mgmtIdl = () => IDL.Service({ canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
  status: IDL.Variant({ running: IDL.Null, stopped: IDL.Null, stopping: IDL.Null }), module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), cycles: IDL.Nat,
  settings: IDL.Record({ controllers: IDL.Vec(IDL.Principal), environment_variables: IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text })) }) })], []) });
type Status = { status: Record<string, null>; module_hash: Uint8Array[]; cycles: bigint; settings: { controllers: Principal[]; environment_variables: { name: string; value: string }[] } };
const observe = async (s: Target) => {
  const cid = Principal.fromText(s.canisterId);
  const mgmt = Actor.createActor(mgmtIdl, { agent, canisterId: 'aaaaa-aa', effectiveCanisterId: cid } as Parameters<typeof Actor.createActor>[1]) as unknown as { canister_status(a: { canister_id: Principal }): Promise<Status> };
  const status = await mgmt.canister_status({ canister_id: cid });
  const certified = await CanisterStatus.request({ agent, canisterId: cid, paths: ['subnet'] });
  const subnet = certified.get('subnet') as { subnetId?: Principal | string } | undefined;
  const actual = { moduleHash: Buffer.from(status.module_hash[0] ?? []).toString('hex'), controllers: status.settings.controllers.map(p => p.toText()),
    running: 'running' in status.status, cycles: status.cycles, subnetId: String(subnet?.subnetId ?? ''), environment: status.settings.environment_variables };
  verifyUpgradeStatus(s, actual, GROUP2_GOVERNOR);
  return { moduleHash: actual.moduleHash, settingsHash: digest([...actual.environment].sort((a,b) => a.name.localeCompare(b.name))), cycles: String(actual.cycles) };
};
const gate = async () => {
  const current = await registry();
  if (current.configurationRevision !== initial.configurationRevision || groupApprovalConfiguration(current.groups, current.placements) !== configuration) throw new Error('Routing configuration changed; stop without replay');
};
const pii = { g1: shared.pii_access_control, g2: provision.canisters.pii_access_control };
const keyGate = (groupId: 'g1' | 'g2', phase: string) => {
  const mapping = join(directory, `${groupId}-pii.json`), receipt = join(directory, `${groupId}-original-key.json`);
  writeFileSync(mapping, JSON.stringify({ pii_access_control: pii[groupId] }));
  const result = spawnSync(process.execPath, [new URL('media-key-deploy-preflight.mjs', import.meta.url).pathname, phase, mapping, receipt, 'mainnet', 'ic'],
    { env: { ...process.env, GOVERNOR: GROUP2_GOVERNOR, DEPLOYER_PEM_FILE: resolve(pem) }, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Original photo-key verification failed');
  return receipt;
};
const observations = [];
for (const t of targets) observations.push({ ...t, ...(await observe(t)) });
// Both stores must still point at their original club authority, including
// the legacy Group 1 pair not covered by registered-group snapshot checks.
for (const groupId of ['g1', 'g2']) {
  const store = targets.find(t => t.groupId === groupId && t.name === 'media_blob_store');
  const club = targets.find(t => t.groupId === groupId && t.name === 'club_domain');
  if (!store || !club) throw new Error('Missing paired authority');
  const reader = Actor.createActor(() => IDL.Service({ read_group_opening_configuration: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text))], []) }),
    { agent, canisterId: store.canisterId }) as unknown as { read_group_opening_configuration(): Promise<[string, string][]> };
  const rows = await reader.read_group_opening_configuration();
  if (rows.filter(r => r[0] === 'club_domain').length !== 1 || rows.find(r => r[0] === 'club_domain')?.[1] !== club.canisterId) throw new Error('Media authority wiring differs');
}
await gate();
if (action === 'check') {
  for (const group of ['g1', 'g2'] as const) keyGate(group, 'before');
  await gate();
  writeFileSync(join(directory, 'check.json'), JSON.stringify({ targets: observations, configurationRevision: String(initial.configurationRevision), liveAcceptance: false }, null, 2));
  console.log('Four existing targets checked; no upgrades or settings changes.');
  process.exit(0);
}
const repo = process.env.GITHUB_REPOSITORY, release = process.env.GITHUB_SHA;
if (!repo || !/^[a-f0-9]{40}$/.test(release ?? '')) throw new Error('GitHub release binding required');
const api = createJournalApi(repo, JSON.stringify), branch = 'subscription-upgrade-receipts';
if (!api(`git/matching-refs/heads/${branch}`).some((r: { ref: string }) => r.ref === `refs/heads/${branch}`)) {
  const meta = api(''), base = api(`git/ref/heads/${meta.default_branch}`);
  api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: base.object.sha });
}
// One active journal prevents a different release from bypassing an unknown install.
const path = 'contents/subscription-upgrade.json';
const entries = api(`contents?ref=${branch}`);
let stored = entries.some((e: { name: string }) => e.name === 'subscription-upgrade.json') ? api(`${path}?ref=${branch}`) : null;
const binding = { release, governor: GROUP2_GOVERNOR, router: shared.shard_router, configurationRevision: String(initial.configurationRevision), configuration, targets, pii };
let journal = stored ? JSON.parse(Buffer.from(stored.content, 'base64').toString()) : null;
if (journal && digest(journal.binding) !== digest(binding)) throw new Error('Another release journal exists; do not reset it. Review its settled outcomes before a separate release.');
if (!journal) {
  const keys = (['g1', 'g2'] as const).map(groupId => ({ groupId, receipt: JSON.parse(readFileSync(keyGate(groupId, 'before'), 'utf8')) }));
  journal = { binding, complete: false, keys, steps: observations.map(s => ({ ...s, oldHash: s.moduleHash, phase: 'ready' })) };
}
validateJournal(journal, binding);
for (const key of journal.keys) writeFileSync(join(directory, `${key.groupId}-original-key.json`), JSON.stringify(key.receipt));
const persist = async () => {
  stored = persistGroup2Journal(api, path, branch, stored, journal, 'subscriptions');
  writeFileSync(join(directory, 'progress.json'), JSON.stringify(journal, null, 2));
};
const verifyKeys = async () => { for (const group of ['g1', 'g2'] as const) keyGate(group, 'after'); };
await persist(); await verifyKeys();
await executeUpgrades(journal, { gate, observe, persist, verifyKeys, install: async (s: Target) => {
  const result = spawnSync('icp', upgradeArgs(s, resolve(artifacts, s.name), GROUP2_GOVERNOR), { cwd: directory, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Upgrade reply failed or unknown; pending journal retained, no automatic replay');
} });
// Update only the two verified G2 fingerprints, never accept unrelated changes.
for (const s of approval.services) {
  const t = targets.find(t => t.groupId === 'g2' && t.name === s.name);
  if (t) { if (s.canisterId !== t.canisterId) throw new Error('Approval inventory changed'); s.moduleHash = t.newHash; }
}
writeFileSync(new URL('deploy/groups/g2/general-opening.json', root), JSON.stringify(approval, null, 2) + '\n');
console.log('Four modules verified; routing state/settings/photo keys preserved. Snapshot refresh and signed-in acceptance still required.');