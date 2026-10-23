/** Existing identity plus ALL registered club sources/original G1 only.
 * Journaled upgrades, separate directory grants, bounded fill/ownership,
 * snapshot/lifecycle acceptance and exact release enable; no group opening,
 * creation, photo-key change, deletion or app publication. */
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
import { GROUP2_GOVERNOR, verifyUpgradeStatus, wasmHash } from '../../scripts/group2-upgrade-rules.mjs';
import { digest, validateRequest, validateTargets, validateJournal, executeUpgrades, runFill, PINNED, requireLookupReleaseAcceptance, directorySources, requireReleaseSourceCoverage, lookupReleaseTargets, lookupUpgradeArgs } from '../../scripts/membership-lookup-release-policy.mjs';
import { configureDirectorySources } from '../../scripts/membership-source-configuration.mjs';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import type { _SERVICE as ClubService } from '../src/lab/bindings/club_domain/declarations/club_domain.did';
import { membershipOwnershipTransport } from './membership-ownership-transport';
import { checkLegacyOwnership } from '../../scripts/membership-legacy-ownership.mjs';
import { fingerprint } from '../../scripts/membership-source-configuration.mjs';
import { runOwnershipAcceptance } from '../../scripts/membership-ownership-acceptance.mjs';
import { requireCompleteFill, checkHistoricalAcceptance, checkReplicaAcceptance } from '../../scripts/membership-acceptance-checks.mjs';
import { recoverRejectedLookup, rejectionEvidence, REJECTED_RELEASE } from '../../scripts/membership-lookup-recovery.mjs';

const [action, artifacts, pem, directory] = process.argv.slice(2);
validateRequest(action, process.env.CONFIRMATION);
// Local contract gate; live enable still requires identity-owned verification.
if (action === 'upgrade') requireLookupReleaseAcceptance();
if (!artifacts || !pem || !directory) throw new Error('Artifacts, existing key and report directory required');
const root = new URL('../../', import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const shared = json('deploy/mainnet/.icp/data/mappings/ic.ids.json');
const provision = json('deploy/groups/g2/provision.json');
if (shared.shard_router !== 'jcdfe-vqaaa-aaaal-qxloq-cai' || shared.identity_access !== PINNED.identity ||
    shared.club_domain !== PINNED.g1) throw new Error('Pinned original mainnet mappings required');
if (provision.canisters.club_domain !== PINNED.g2) throw new Error('Pinned Group 2 club service required');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GROUP2_GOVERNOR) throw new Error('Original governor identity required');
mkdirSync(directory, { recursive: true });
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const router = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: shared.shard_router });
const registry = () => readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page('mainnet', rev, cursor, limit));
const initial = await registry();
// Validate the exact complete service/subnet inventory before any upgrade,
// not after installing and discovering identity would reject the binding.
const domains = ['club_domain','events_domain','messaging_domain','vault_domain','competition_domain','club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','timer_jobs','secret_workload_identity'];
const serviceIds = new Set<string>();
let workload: string | undefined;
let subnetPolicy: string | undefined;
for (const group of initial.groups) {
  const placement = initial.placements.find(p=>p.group_id===group.id);
  if (!placement || group.domains.length!==domains.length || placement.domains.length!==domains.length ||
      new Set(group.domains.map(d=>d.domain)).size!==domains.length || new Set(placement.domains.map(d=>d.domain)).size!==domains.length) throw new Error('Complete unique membership source service inventory required');
  const approved=placement.approved_subnets.map(p=>p.toText()).sort();
  const policy=JSON.stringify([placement.primary_subnet.toText(),approved,placement.additional_subnets_enabled]);
  if (!approved.length || new Set(approved).size!==approved.length || !approved.includes(placement.primary_subnet.toText()) ||
      (subnetPolicy!==undefined && subnetPolicy!==policy)) throw new Error('Exact common approved subnet policy required');
  subnetPolicy=policy;
  for(const d of group.domains){
    const id=d.canister.toText(),placed=placement.domains.find(p=>p.domain===d.domain);
    if(!domains.includes(d.domain)||['aaaaa-aa','2vxsx-fae',PINNED.identity].includes(id)||!placed||placed.canister.toText()!==id||
      !approved.includes(placed.subnet.toText())||(!placement.additional_subnets_enabled&&placed.subnet.toText()!==placement.primary_subnet.toText())) throw new Error('Invalid membership source authority/placement');
    if(d.domain==='secret_workload_identity'){
      if(workload!==undefined&&workload!==id)throw new Error('Shared workload differs');
      if(workload===undefined&&serviceIds.has(id))throw new Error('Shared workload collision');
      workload=id;
    }else if(serviceIds.has(id))throw new Error('Membership source service collision');
    serviceIds.add(id);
  }
}
const observedSources = directorySources(initial);
// Independent complete-source gate BEFORE any upgrade/journal write. Check
// may inspect G3 and later groups; this release never upgrades them implicitly.
if (action === 'upgrade') requireReleaseSourceCoverage(observedSources, initial);
if (initial.configurationRevision === undefined) throw new Error('Configuration-bound router required');
const configuration = groupApprovalConfiguration(initial.groups, initial.placements);
const liveG2 = initial.groups.find(g => g.id === 'g2');
const placement = initial.placements.find(p => p.group_id === 'g2');
if (!liveG2 || !placement || placement.deployment_id !== 'mainnet' || placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet' ||
    liveG2.domains.find(d => d.domain === 'club_domain')?.canister.toText() !== PINNED.g2) throw new Error('Registered Group 2 inventory differs');
const targets = lookupReleaseTargets(initial, {
  identity_access: wasmHash(readFileSync(resolve(artifacts, 'identity_access'))),
  club_domain: wasmHash(readFileSync(resolve(artifacts, 'club_domain'))),
});
validateTargets(targets, observedSources);
const firstPlacement = initial.placements[0];
if (!firstPlacement) throw new Error('Directory deployment placement required');
const directoryBinding = { registry: Principal.fromText(shared.shard_router), registry_revision: initial.revision,
  target_alias: 'mainnet', deployment_id: firstPlacement.deployment_id, deployment_revision: firstPlacement.deployment_revision,
  host: firstPlacement.host, network_kind: firstPlacement.network_kind };
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
  if (current.revision !== initial.revision || current.configurationRevision !== initial.configurationRevision || groupApprovalConfiguration(current.groups, current.placements) !== configuration) throw new Error('Routing configuration changed; stop without replay');
};
const observations = [];
for (const t of targets) observations.push({ ...t, ...(await observe(t)) });
await gate();
if (action === 'check') {
  const transport = membershipOwnershipTransport(agent, registry);
  const ownership = await checkLegacyOwnership({ ...transport, registry: async () => {
    const current = await transport.registry();
    if (current.fingerprint !== fingerprint(initial)) throw new Error('Registry changed after target checks');
    return current;
  } });
  await gate();
  writeFileSync(resolve(directory, 'check.json'), JSON.stringify({ targets: observations, sources: observedSources, ownership,
    configurationRevision: String(initial.configurationRevision), liveAcceptance: false, ready: false, appEnabled: false }, null, 2));
  console.log('Pinned targets and every membership source checked; no upgrades, grants or app activation.');
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
const binding = { release, governor: GROUP2_GOVERNOR, router: shared.shard_router, registryRevision: String(initial.revision), directoryBinding: JSON.parse(fingerprint(directoryBinding)), configurationRevision: String(initial.configurationRevision), configuration, sources: observedSources, targets };
let journal = stored ? JSON.parse(Buffer.from(stored.content, 'base64').toString()) : null;
if (journal && digest(journal.binding) !== digest(binding)) {
  // Read the original GitHub run, not user-pasted or locally edited evidence.
  journal = await recoverRejectedLookup(journal, binding, { gate, observe,
    evidence: async () => {
      const result = api(`actions/workflows/release-membership-lookup.yml/runs?head_sha=${REJECTED_RELEASE}&status=failure&per_page=100`);
      const runs = result.workflow_runs.filter((r: { head_sha: string; conclusion: string }) => r.head_sha === REJECTED_RELEASE && r.conclusion === 'failure');
      for (const run of runs) {
        const jobs = api(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
        const job = jobs.jobs.find((j: { name: string; conclusion: string }) => j.name === 'release' && j.conclusion === 'failure');
        if (!job) continue;
        const failed = job.steps?.filter((s: { conclusion: string }) => s.conclusion === 'failure');
        if (failed?.length !== 1 || failed[0].name !== 'Check every membership source or run the protected lookup release') continue;
        const logs = spawnSync('gh', ['run','view',String(run.id),'--repo',repo,'--attempt',String(run.run_attempt),'--job',String(job.id),'--log-failed'], { encoding:'utf8', maxBuffer:16*1024*1024 });
        if (logs.status !== 0) throw new Error('Original failed-run logs unavailable; pending record retained');
        try { return { ...rejectionEvidence(run, logs.stdout), attempt:run.run_attempt, jobId:job.id }; }
        catch { /* A different failed attempt is not recovery evidence. */ }
      }
      throw new Error('Original CLI rejection cannot be verified from GitHub; pending record retained');
    },
    persist: async (recovered: unknown) => {
      stored = persistGroup2Journal(api, path, branch, stored, recovered, 'membership-lookup');
      writeFileSync(resolve(directory, 'progress.json'), JSON.stringify(recovered, null, 2));
    },
  });
  console.log('Verified the original CLI rejection and two complete unchanged live inventories; original intent retained in recovery receipt.');
}
if (!journal) {
  journal = { binding, complete: false, ready: false, fill: Object.fromEntries(observedSources.map(s => [s.groupId, false])), steps: observations.map(s => ({ ...s, oldHash: s.moduleHash, phase: 'ready' })) };
}
validateJournal(journal, binding);
const persist = async () => {
  stored = persistGroup2Journal(api, path, branch, stored, journal, 'membership-lookup');
  writeFileSync(resolve(directory, 'progress.json'), JSON.stringify(journal, null, 2));
};
await persist();
await executeUpgrades(journal, { gate, observe, persist, verifyKeys: async () => {}, install: async (s: Target) => {
  const result = spawnSync('icp', lookupUpgradeArgs(s, resolve(artifacts, s.name), GROUP2_GOVERNOR), { cwd: directory, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Upgrade reply failed or unknown; pending journal retained, no automatic replay');
} });
// Actual generated Candid contract, one bounded source request at a time.
// Do not skip previous historical completion: a newer revision may be pending.
const fillActor = Actor.createActor<IdentityService>(identityIdl, { agent, canisterId: PINNED.identity });
// Same complete source set checked before mutation; original G1 is supported
// by identity's explicit pinned-source verifier, never by a fake placement.
const sources = observedSources.map((s: { groupId: string; canisterId: string }) => ({ groupId: s.groupId, authority: Principal.fromText(s.canisterId) }));
const sourceActors = new Map(sources.map(s => [s.groupId, Actor.createActor<ClubService>(clubIdl, { agent, canisterId: s.authority })]));
const sourceActor = (source: { groupId: string }) => {
  const actor = sourceActors.get(source.groupId); if (!actor) throw new Error('Unknown exact source'); return actor;
};
// An unknown/completed enable must not replay configuration or stale fill
// against an already released identity. Exact release retry rechecks reality.
if (journal.activation) {
  await gate();
  const resumed = await fillActor.enable_membership_directory(release);
  if ('Err' in resumed || !resumed.Ok.app_enabled || !resumed.Ok.snapshot_verified || !resumed.Ok.restoration_guard_verified) throw new Error('Lookup activation reconciliation refused; intent retained');
  await gate();
  journal.activation.phase = 'complete'; await persist();
  writeFileSync(resolve(directory, 'release.json'), JSON.stringify({ release, sources: observedSources, appReaderReleased: true, signedUserVerified: false, published: false }, null, 2));
  console.log('Exact lookup release reconciled without replaying grants or installs; user verification and publication remain separate.');
  process.exit(0);
}
const configured = await configureDirectorySources(directoryBinding, sources, 1n, {
  identity: Principal.fromText(PINNED.identity),
  gate,
  configure: (b: typeof directoryBinding, authorities: Principal[], generation: bigint) => fillActor.configure_membership_directory(b, authorities, generation),
  configuration: () => fillActor.read_membership_directory_configuration(),
  sourceConfiguration: (source: { groupId: string }) => sourceActor(source).read_membership_directory_source_binding(),
  configureSource: (source: { groupId: string }, grant: Parameters<ClubService['configure_membership_directory_source']>[0]) => sourceActor(source).configure_membership_directory_source(grant),
  persist: async (checkpoint: unknown) => { journal.configuration = JSON.parse(fingerprint(checkpoint)); await persist(); },
});
journal.directoryInventoryDigest = Array.from(configured.grants[0].inventory_digest);await persist();
const completed = await runFill(observedSources.map((s: { groupId: string }) => s.groupId), async (groupId: string) => {
  await gate();
  const progress = await fillActor.advance_membership_directory_source(groupId);
  await gate();
  return progress;
}, { persist: async (groupId: string, revision: bigint) => {
  journal.fill[groupId] = true;
  journal.acknowledgedRevisions = { ...journal.acknowledgedRevisions, [groupId]: String(revision) };
  await persist();
} });
requireCompleteFill(sources, completed);
await gate();
const ownership = await runOwnershipAcceptance(() => fillActor.advance_membership_directory_ownership(), {
  sources, completed, inventoryDigest: configured.grants[0]?.inventory_digest,
}, { gate, persist: async (ownership: unknown) => {
  journal.ownership = JSON.parse(fingerprint(ownership)); journal.ready = false; await persist();
} });
const acceptance = await checkHistoricalAcceptance({ sources, completed, ownership,
  inventoryDigest: configured.grants[0].inventory_digest, binding: directoryBinding, generation: 1n,
  targets: journal.steps,
}, { gate, configuration: () => fillActor.read_membership_directory_configuration(),
  status: (source: { groupId: string }) => sourceActor(source).read_membership_discovery_status(), observe });
journal.acceptance = acceptance;await persist();
writeFileSync(resolve(directory, 'acceptance.json'), JSON.stringify(acceptance, null, 2));
const replicaAcceptance = await checkReplicaAcceptance(sources, completed, {
  gate, check: () => fillActor.check_membership_directory_acceptance(),
});
journal.replicaAcceptance = replicaAcceptance;await persist();
writeFileSync(resolve(directory, 'replica-acceptance.json'), JSON.stringify(replicaAcceptance, null, 2));
// Intent before the idempotent identity-owned enable. A lost response is
// reconciled only by repeating the SAME release with fresh snapshot checks.
journal.activation = { release, phase: 'pending' }; await persist();
await gate();
const enabled = await fillActor.enable_membership_directory(release);
if ('Err' in enabled) throw new Error(enabled.Err);
if (!enabled.Ok.app_enabled || !enabled.Ok.snapshot_verified || !enabled.Ok.restoration_guard_verified) throw new Error('Lookup release not verified');
await gate();
const readback = await fillActor.read_membership_directory_configuration();
if ('Err' in readback || !readback.Ok.app_enabled) throw new Error('Lookup enable readback failed; intent retained');
journal.activation = { release, phase: 'complete' };
// Readiness remains page-specific; this receipt never grants access or claims
// that a real user's complete traversal or loading speed has been verified.
journal.ready = false; await persist();
writeFileSync(resolve(directory, 'release.json'), JSON.stringify({ release, sources: observedSources,
  appReaderReleased: true, signedUserVerified: false, published: false }, null, 2));
console.log('All membership sources upgraded, filled and snapshot-verified; identity-owned reader released. App publication and real-user timing remain separate.');
