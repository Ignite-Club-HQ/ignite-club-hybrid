import { digest, executeUpgrades } from './subscription-upgrade-policy.mjs';
import { GROUP_BUILD_SERVICES } from './stage-group-wasm.mjs';
import { validateGroup2Inventory, upgradeArgs, GROUP2_GOVERNOR } from './group2-upgrade-rules.mjs';
export { digest, executeUpgrades };
export const PRIMARY_SUBNET = 'e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe';
export const SHARED_SERVICES = Object.freeze(['shard_router', 'identity_access', 'placement_registry', 'migration_coordinator', 'secret_workload_identity']);
export const SCOPES = Object.freeze({
  full_backend: [...SHARED_SERVICES.filter(name=>name!=='shard_router'), ...GROUP_BUILD_SERVICES, 'shard_router'],
  app_admin: ['identity_access', 'notification_queue'],
  club_migration: ['club_domain'],
  private_name_cleanup: ['identity_access', 'pii_access_control', 'club_domain'],
  secure_name_save: ['pii_access_control', 'identity_access'],
  private_club_name_display: ['pii_access_control', 'club_domain', 'identity_access'],
  team_invites: ['club_domain', 'mini_league_domain'],
  messaging: ['messaging_domain'],
  competition: ['notification_queue', 'club_domain', 'events_domain', 'competition_domain'],
  history: ['events_domain', 'competition_domain'],
  subscriptions: ['club_domain', 'media_blob_store'],
  events_pitch: ['notification_queue', 'club_domain', 'events_domain'],
  gallery_vault: ['club_domain', 'media_blob_store', 'media_metadata', 'vault_domain', 'messaging_domain', 'notification_queue'],
});
/** Copy/paste from chat or phones can add spaces, line breaks, quotes or invisible characters. */
export const normalizePlan = v => String(v ?? '').replace(/[\s"'`\u200b-\u200d\u2060\ufeff\u2018\u2019\u201c\u201d]/g, '').toLowerCase();
export const normalizeConfirmation = v => String(v ?? '').replace(/[\u200b-\u200d\u2060\ufeff"'`\u2018\u2019\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
export function validateRequest(action, scope, confirmation, checkedPlan) {
  action = String(action ?? '').trim(); scope = String(scope ?? '').trim();
  if (!['check', 'upgrade', 'recover'].includes(action) || !Object.hasOwn(SCOPES, scope)) throw Error('Choose a reviewed scope and check, upgrade or recover');
  const words = { recover: 'RECOVER COMPLETED MAINNET RELEASE', upgrade: 'UPGRADE ALL MAINNET GROUPS' }[action];
  if (words) {
    const c = normalizeConfirmation(confirmation), plan = normalizePlan(checkedPlan);
    if (c !== words) throw Error(`Confirmation box must say ${words} (received ${c.length} characters${c ? ` starting "${c.slice(0, 12)}"` : ''})`);
    if (!/^[a-f0-9]{64}$/.test(plan)) throw Error(`Checked plan box must be the 64-character plan hash (received ${plan.length} characters after removing spaces)`);
  }
  return SCOPES[scope];
}
const text = p => typeof p === 'string' ? p : p?.toText();
const validId = id => typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(id) && !['aaaaa-aa', '2vxsx-fae'].includes(id);
/** Complete saved + consensus inventory. Only explicit shared workload aliases may repeat. */
export function planInventory(shared, provisions, registry, scope, hashes) {
  const names = validateRequest('check', scope);
  if (shared.shard_router !== 'jcdfe-vqaaa-aaaal-qxloq-cai' || shared.identity_access !== 'mq2sj-fiaaa-aaaal-qxlqa-cai' || shared.club_domain !== 'mzzzv-taaaa-aaaal-qxlrq-cai' || shared.pii_access_control !== 'iui5p-aaaaa-aaaal-qxllq-cai' || shared.media_blob_store !== 'jlaoy-dyaaa-aaaal-qxlpa-cai') throw Error('Pinned original mainnet mappings required');
  if (registry.configurationRevision === undefined || registry.groups.length > 99 || !registry.groups.length || registry.placements.length !== registry.groups.length) throw Error('Complete bounded configuration-bound registry required');
  const savedIds = provisions.map(p => p.groupId);
  const expectedDomains = GROUP_BUILD_SERVICES.filter(n=>n!=='media_blob_store');
  for (const provision of provisions) if (Object.keys(provision.canisters??{}).length!==expectedDomains.length || Object.keys(provision.canisters).some(n=>!expectedDomains.includes(n)) || new Set(provision.installedDomains??[]).size!==expectedDomains.length || expectedDomains.some(n=>!provision.installedDomains?.includes(n))) throw Error('Exact unique saved domain names required');
  const liveIds = registry.groups.map(g => g.id);
  if (new Set(savedIds).size !== savedIds.length || new Set(liveIds).size !== liveIds.length || registry.placements.some(p => !liveIds.includes(p.group_id)) || new Set(registry.placements.map(p => p.group_id)).size !== liveIds.length || savedIds.some(id => !liveIds.includes(id)) || liveIds.some(id => id !== 'g1' && !savedIds.includes(id))) throw Error('Saved and live group inventory differ');
  const all = [{ id: 'g1', services: GROUP_BUILD_SERVICES.map(name => ({ name, canisterId: shared[name], subnetId: PRIMARY_SUBNET })) },
    ...provisions.map(p => ({ id: p.groupId, services: validateGroup2Inventory(p, shared, p.groupId) }))].sort((a,b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const seen = new Set(Object.values(shared));
  if (scope === 'full_backend' && (Object.keys(shared).length !== SCOPES.full_backend.length || Object.keys(shared).some(name => !SCOPES.full_backend.includes(name)))) throw Error('Unreviewed shared canister inventory; update the complete release policy before upgrading');
  if (seen.size !== Object.keys(shared).length || Object.values(shared).some(id => !validId(id))) throw Error('Invalid or colliding shared mappings');
  for (const g of all) {
    if (g.id !== 'g1') for (const s of g.services) { if (!validId(s.canisterId) || seen.has(s.canisterId)) throw Error('Cross-group canister collision'); seen.add(s.canisterId); }
    const live = registry.groups.find(row => row.id === g.id);
    if (!live && g.id === 'g1') continue;
    const placement = registry.placements.find(p => p.group_id === g.id);
    const domains = GROUP_BUILD_SERVICES.filter(n => n !== 'media_blob_store').concat('secret_workload_identity');
    if (!live || !placement || live.target_alias !== 'mainnet' || placement.deployment_id !== 'mainnet' || placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet' || live.domains.length !== domains.length || placement.domains.length !== domains.length || new Set(live.domains.map(d=>d.domain)).size !== domains.length || new Set(placement.domains.map(d=>d.domain)).size !== domains.length) throw Error('Complete mainnet domain placement required');
    const approved = placement.approved_subnets.map(text);
    if (!approved.length || new Set(approved).size !== approved.length || !approved.includes(text(placement.primary_subnet))) throw Error('Invalid approved subnet policy');
    for (const name of domains) {
      const s = name === 'secret_workload_identity' ? { canisterId: shared[name], subnetId: PRIMARY_SUBNET } : g.services.find(s=>s.name===name);
      const placed = placement.domains.find(d=>d.domain===name);
      if (!s || !placed || text(live.domains.find(d=>d.domain===name)?.canister) !== s.canisterId || text(placed.canister)!==s.canisterId || text(placed.subnet)!==s.subnetId || !approved.includes(s.subnetId) || (!placement.additional_subnets_enabled && s.subnetId !== text(placement.primary_subnet))) throw Error(`Placement differs: ${g.id}/${name}`);
    }
    if (text(live.photo_store[0]) !== g.services.find(s=>s.name==='media_blob_store')?.canisterId) throw Error('Photo store differs');
  }
  const targets = names.flatMap(name => SHARED_SERVICES.includes(name) ? [{groupId:'shared',name,canisterId:shared[name],subnetId:PRIMARY_SUBNET,newHash:hashes[name]}] : all.map(g => ({ groupId:g.id, ...g.services.find(s=>s.name===name), newHash:hashes[name] })));
  if (targets.some(t=>!t.name || !validId(t.canisterId) || !/^[a-f0-9]{64}$/.test(t.newHash ?? '')) || new Set(targets.map(t=>t.canisterId)).size!==targets.length) throw Error('Incomplete upgrade artifacts/targets');
  return { groups: all, targets, pii: Object.fromEntries(all.map(g=>[g.id,g.services.find(s=>s.name==='pii_access_control').canisterId])) };
}
export function installArgs(target, path) {
  if (!GROUP_BUILD_SERVICES.includes(target.name) && !SHARED_SERVICES.includes(target.name)) throw Error('Unreviewed install runtime');
  const args = upgradeArgs(target, path, GROUP2_GOVERNOR);
  if (['identity_access', 'shard_router', 'placement_registry'].includes(target.name)) {
    args.splice(args.indexOf('--wasm-memory-persistence'), 2);
    args[args.indexOf('--args')+1] = `(record { governor = principal "${GROUP2_GOVERNOR}" })`;
  }
  return args;
}
export function validateJournal(journal, binding) {
  if (!journal || digest(journal.binding)!==digest(binding) || typeof journal.complete!=='boolean' || typeof journal.published!=='boolean' || journal.steps?.length!==binding.targets.length || new Set(journal.steps.map(s=>s.canisterId)).size!==binding.targets.length || journal.keys?.length!==Object.keys(binding.pii).length) throw Error('Foreign or incomplete all-group journal');
  for (const t of binding.targets) {
    const s=journal.steps.find(s=>s.canisterId===t.canisterId);
    if (!s || ['name','groupId','subnetId','newHash'].some(k=>s[k]!==t[k]) || !/^[a-f0-9]{64}$/.test(s.oldHash ?? '') || !/^[a-f0-9]{64}$/.test(s.settingsHash ?? '') || !['ready','pending','complete'].includes(s.phase)) throw Error('Invalid all-group journal step');
  }
  if(['private_name_cleanup','secure_name_save','private_club_name_display'].includes(binding.scope)) {
    const plan=binding.cleanupPlan,rows=journal.cleanupActivation;
    if(!Array.isArray(plan)||plan.length!==binding.targets.length||new Set(plan.map(s=>s.canisterId)).size!==plan.length||plan.some(p=>!binding.targets.some(t=>['canisterId','name','groupId','subnetId','newHash'].every(k=>t[k]===p[k]))||!['oldSettingsHash','newSettingsHash'].every(k=>/^[a-f0-9]{64}$/.test(p[k]??''))))throw Error('Invalid checked cleanup activation plan');
    if(rows!==undefined && (!Array.isArray(rows)||rows.length!==plan.length||plan.some(p=>rows.filter(s=>Object.keys(p).every(k=>s[k]===p[k])&&['ready','pending','complete'].includes(s.phase)).length!==1)))throw Error('Foreign cleanup activation journal');
    if(journal.complete && (!rows || rows.some(s=>s.phase!=='complete')))throw Error('Cleanup activation not settled');
  }
  for (const [groupId,canisterId] of Object.entries(binding.pii)) {
    const r=journal.keys.find(k=>k.groupId===groupId)?.receipt;
    if (!r || r.canisterId!==canisterId || r.governor!==binding.governor || r.host!=='https://icp-api.io' || r.deploymentId!=='mainnet' || r.environment!=='ic' || r.keyName!=='key_1' || !/^[a-f0-9]{192}$/.test(r.publicKeyHex ?? '') || !/^[a-f0-9]{64}$/.test(r.moduleHash ?? '')) throw Error('Original group photo-key receipt required');
  }
  if (journal.complete && (journal.steps.some(s=>s.phase!=='complete') || journal.snapshotVerified!==true || !Array.isArray(journal.snapshotFiles) || journal.snapshotFiles.length===0 || digest(journal.snapshotFiles)!==journal.snapshotFilesHash) || journal.published && !journal.complete) throw Error('Unsettled journal cannot be complete/published');
}
export function requireSettledPredecessor(journal) {
  if (!journal || journal.complete!==true || journal.published!==true || !Array.isArray(journal.steps) || journal.steps.some(s=>s.phase!=='complete')) throw Error('Previous release is unresolved; retain journal and reconcile');
}
/** Lookup ready is user-facing acceptance, not an installation/activation phase.
 * Its legacy release report always emits published:false before the workflow's
 * later snapshot publication; the successor produces and publishes fresh evidence.
 * Never mutate the predecessor or turn readiness into an authorization grant. */
export function requireSettledNarrowRelease(branch, journal) {
  const fail = () => { throw Error(`Unsettled existing release: ${branch}; reconcile before any all-group upgrade`); };
  if (!journal || journal.complete !== true || !Array.isArray(journal.steps) || !journal.steps.length || journal.steps.some(step => step.phase !== 'complete') || journal.backfill && Object.values(journal.backfill).some(value => value !== true)) fail();
  if (branch !== 'membership-lookup-release-receipts') {
    if (journal.ready === false) fail();
    return;
  }
  const sources = journal.binding?.sources;
  if (!Array.isArray(sources) || !sources.length || new Set(sources.map(source => source.groupId)).size !== sources.length || !journal.fill || Object.keys(journal.fill).length !== sources.length || sources.some(source => journal.fill[source.groupId] !== true)) fail();
  if (!Array.isArray(journal.binding?.targets) || journal.steps.length !== journal.binding.targets.length || new Set(journal.steps.map(step => step.canisterId)).size !== journal.steps.length || journal.binding.targets.some(target => !journal.steps.some(step => step.canisterId === target.canisterId && step.name === target.name && step.newHash === target.newHash))) fail();
  if (!/^[a-f0-9]{40}$/.test(journal.binding?.release ?? '') || journal.activation?.phase !== 'complete' || journal.activation.release !== journal.binding.release || journal.ownership?.complete !== true || journal.replicaAcceptance?.snapshotVerified !== true || journal.replicaAcceptance?.restorationGuardVerified !== true) fail();
}
export function assertCheckedPlan(expected, actual) { if (expected!==actual) throw Error('Checked plan changed; run check on this exact revision/inventory/artifacts'); }
/** Recovery never adopts pending or ready steps, even when module hashes match. */
export function requireCompletedRecovery(journal, {repo, scope, checkedPlan, source, branch}) {
  if (!journal?.binding) throw Error('Existing release journal required; no recovery journal may be created');
  validateJournal(journal, journal.binding);
  if (journal.binding.repo !== repo || journal.binding.scope !== scope || digest(journal.binding) !== checkedPlan || !/^[a-f0-9]{40}$/.test(journal.binding.release ?? '') || journal.modulesComplete !== true || journal.steps.some(s=>s.phase !== 'complete') || journal.published) throw Error('Recovery requires the exact acknowledged module-complete unpublished release');
  if (!/^[a-f0-9]{40}$/.test(source ?? '') || !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(branch ?? '')) throw Error('Recovery source and branch required');
  if (journal.recovery && (journal.recovery.source !== source || journal.recovery.branch !== branch || journal.recovery.planHash !== checkedPlan)) throw Error('Recovery source changed; resume the pinned recovery run');
  const hashes = {};
  for (const t of journal.binding.targets) {
    if (hashes[t.name] && hashes[t.name] !== t.newHash) throw Error('Conflicting saved artifacts');
    hashes[t.name] = t.newHash;
  }
  return {release:journal.binding.release, hashes, recovery:{source, branch, planHash:checkedPlan}};
}
export function galleryAuthorities(inventory, target, provisions) {
  const group = inventory.groups.find(g=>g.id===target.groupId);
  const own = name => group?.services.find(s=>s.name===name)?.canisterId;
  const club=own('club_domain'), vault=own('vault_domain');
  if (!validId(club) || !validId(vault) || own('media_metadata') !== target.canisterId) throw Error(`Gallery authority inventory missing for ${target.groupId}; stop without rewiring`);
  const provision=provisions.find(p=>p.groupId===target.groupId);
  if (provision && (provision.canisters?.club_domain !== club || provision.canisters?.vault_domain !== vault)) throw Error(`Gallery authority inventory disagrees for ${target.groupId}; stop without rewiring`);
  return {club, vault};
}
/** Two complete evidence sweeps; deliberately exposes no install capability. */
export async function verifyCompletedRecovery(journal, {gate, observe, verifyKeys}) {
  if(journal.modulesComplete!==true || journal.steps.some(s=>s.phase!=='complete'))throw Error('Unacknowledged modules cannot recover');
  for(let pass=0;pass<2;pass++){
    await gate();
    for(const step of journal.steps){
      const actual=await observe(step);
      if(actual.moduleHash!==step.newHash || actual.settingsHash!==step.settingsHash)throw Error('Recovery module/settings drift; no writes permitted');
    }
    await verifyKeys();await gate();
  }
}