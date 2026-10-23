/** Existing identity_access + two club_domain upgrade and bounded membership
 * fill only. No creation, wiring, photo/PII/messaging changes or opening.
 * Upgrade remains blocked before mutation until release acceptance exists.
 * Historical fill is diagnostic only; the app-side lookup stays disabled. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { groupApprovalConfiguration } from '../src/live/groupApproval';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import type { _SERVICE as IdentityService } from '../src/lab/bindings/identity_access/declarations/identity_access.did';
import { createJournalApi } from './media-stage-two-github.mjs';
import { persistGroup2Journal } from '../../scripts/group2-journal.mjs';
import { GROUP2_GOVERNOR, validateGroup2Inventory, verifyUpgradeStatus, upgradeArgs, wasmHash } from '../../scripts/group2-upgrade-rules.mjs';
import { digest, validateRequest, validateTargets, validateJournal, executeUpgrades, runFill, PINNED, requireLookupReleaseAcceptance } from '../../scripts/membership-lookup-release-policy.mjs';
import { configureDirectorySources } from '../../scripts/membership-source-configuration.mjs';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import type { _SERVICE as ClubService } from '../src/lab/bindings/club_domain/declarations/club_domain.did';

const [action, artifacts, pem, directory] = process.argv.slice(2);
validateRequest(action, process.env.CONFIRMATION);
// Refuse BEFORE management calls, journal writes or installation. The current
// runner has no exact source-grant configuration or current-readiness verifier.
if (action === 'upgrade') requireLookupReleaseAcceptance();
if (!artifacts || !pem || !directory) throw new Error('Artifacts, existing key and report directory required');
const root = new URL('../../', import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const shared = json('deploy/mainnet/.icp/data/mappings/ic.ids.json');
const provision = json('deploy/groups/g2/provision.json');
if (shared.shard_router !== 'jcdfe-vqaaa-aaaal-qxloq-cai' || shared.identity_access !== PINNED.identity ||
    shared.club_domain !== PINNED.g1) throw new Error('Pinned original mainnet mappings required');
if (provision.canisters.club_domain !== PINNED.g2) throw new Error('Pinned Group 2 club service required');
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
    liveG2.domains.find(d => d.domain === 'club_domain')?.canister.toText() !== PINNED.g2) throw new Error('Registered Group 2 inventory differs');
const primarySubnet = 'e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe';
const targets = [
  { groupId: 'shared', name: 'identity_access', canisterId: PINNED.identity, subnetId: primarySubnet, newHash: wasmHash(readFileSync(resolve(artifacts, 'identity_access'))) },
  ...(['g1', 'g2'] as const).map(groupId => {
    const s = g2.find(s => s.name === 'club_domain');
    if (!s) throw new Error('Missing Group 2 club service');
    return { groupId, name: 'club_domain', canisterId: PINNED[groupId], subnetId: groupId === 'g1' ? primarySubnet : s.subnetId, newHash: wasmHash(readFileSync(resolve(artifacts, 'club_domain'))) };
  }),
];
validateTargets(targets);
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
  return { moduleHash: actual.moduleHash, settingsHash: digest([...actual.environment].sort((a, b) => a.name.localeCompare(b.name))), cycles: String(actual.cycles) };
};
const gate = async () => {
  const current = await registry();
  if (current.configurationRevision !== initial.configurationRevision || groupApprovalConfiguration(current.groups, current.placements) !== configuration) throw new Error('Routing configuration changed; stop without replay');
};
const observations = [];
for (const t of targets) observations.push({ ...t, ...(await observe(t)) });
await gate();
if (action === 'check') {
  writeFileSync(resolve(directory, 'check.json'), JSON.stringify({ targets: observations, configurationRevision: String(initial.configurationRevision), liveAcceptance: false }, null, 2));
  console.log('Three existing lookup targets checked; no upgrades or settings changes.');
  process.exit(0);
}
const repo = process.env.GITHUB_REPOSITORY, release = process.env.GITHUB_SHA;
if (!repo || !/^[a-f0-9]{40}$/.test(release ?? '')) throw new Error('GitHub release binding required');
const api = createJournalApi(repo, JSON.stringify), branch = 'membership-lookup-release-receipts';
if (!api(`git/matching-refs/heads/${branch}`).some((r: { ref: string }) => r.ref === `refs/heads/${branch}`)) {
  const meta = api(''), base = api(`git/ref/heads/${meta.default_branch}`);
  api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: base.object.sha });
}
// One active journal prevents a different release from bypassing an unknown install.
const path = 'contents/membership-lookup-release.json';
const entries = api(`contents?ref=${branch}`);
let stored = entries.some((e: { name: string }) => e.name === 'membership-lookup-release.json') ? api(`${path}?ref=${branch}`) : null;
const binding = { release, governor: GROUP2_GOVERNOR, router: shared.shard_router, configurationRevision: String(initial.configurationRevision), configuration, targets };
let journal = stored ? JSON.parse(Buffer.from(stored.content, 'base64').toString()) : null;
if (journal && digest(journal.binding) !== digest(binding)) throw new Error('Another release journal exists; do not reset it. Review its settled outcomes before a separate release.');
if (!journal) {
  journal = { binding, complete: false, ready: false, fill: { g1: false, g2: false }, steps: observations.map(s => ({ ...s, oldHash: s.moduleHash, phase: 'ready' })) };
}
validateJournal(journal, binding);
const persist = async () => {
  stored = persistGroup2Journal(api, path, branch, stored, journal, 'membership-lookup');
  writeFileSync(resolve(directory, 'progress.json'), JSON.stringify(journal, null, 2));
};
await persist();
await executeUpgrades(journal, { gate, observe, persist, verifyKeys: async () => {}, install: async (s: Target) => {
  const result = spawnSync('icp', upgradeArgs(s, resolve(artifacts, s.name), GROUP2_GOVERNOR), { cwd: directory, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Upgrade reply failed or unknown; pending journal retained, no automatic replay');
} });
// Actual generated Candid contract, one bounded source request at a time.
// Do not skip previous historical completion: a newer revision may be pending.
const fillActor = Actor.createActor<IdentityService>(identityIdl, { agent, canisterId: PINNED.identity });
// Complete inventory only. In particular, the original unregistered G1 cannot
// be silently appended to this identity verifier's registered-source contract.
const sources = initial.groups.map(g => {
  const domain = g.domains.find(d => d.domain === 'club_domain');
  if (!domain) throw new Error('Missing registered directory source');
  return { groupId: g.id, authority: domain.canister };
});
if (!sources.some(s => s.groupId === 'g1' && s.authority.toText() === PINNED.g1) ||
    sources.some(s => !['g1', 'g2'].includes(s.groupId))) throw new Error('Exact release-covered complete source inventory required; legacy or additional group coverage is unfinished');
const firstPlacement = initial.placements[0];
if (!firstPlacement) throw new Error('Directory deployment placement required');
const directoryBinding = { registry: Principal.fromText(shared.shard_router), registry_revision: initial.revision,
  target_alias: 'mainnet', deployment_id: firstPlacement.deployment_id, deployment_revision: firstPlacement.deployment_revision,
  host: firstPlacement.host, network_kind: firstPlacement.network_kind };
const sourceActors = new Map(sources.map(s => [s.groupId, Actor.createActor<ClubService>(clubIdl, { agent, canisterId: s.authority })]));
const sourceActor = (source: { groupId: string }) => {
  const actor = sourceActors.get(source.groupId); if (!actor) throw new Error('Unknown exact source'); return actor;
};
await configureDirectorySources(directoryBinding, sources, 1n, {
  gate,
  configure: (b: typeof directoryBinding, authorities: Principal[], generation: bigint) => fillActor.configure_membership_directory(b, authorities, generation),
  configuration: () => fillActor.read_membership_directory_configuration(),
  sourceConfiguration: (source: { groupId: string }) => sourceActor(source).read_membership_directory_source_binding(),
  configureSource: (source: { groupId: string }, grant: Parameters<ClubService['configure_membership_directory_source']>[0]) => sourceActor(source).configure_membership_directory_source(grant),
  persist: async (checkpoint: unknown) => { journal.configuration = checkpoint; await persist(); },
});
await runFill(['g1', 'g2'], async (groupId: string) => {
  await gate();
  const progress = await fillActor.advance_membership_directory_source(groupId);
  await gate();
  return progress;
}, { persist: async (groupId: string, revision: bigint) => {
  journal.fill[groupId] = true;
  journal.acknowledgedRevisions = { ...journal.acknowledgedRevisions, [groupId]: String(revision) };
  await persist();
} });
await gate();
journal.ready = false; await persist();
throw new Error('Historical source fill acknowledged; ownership and verified-current acceptance are still required. No readiness record or app activation.');
