/** Pure rules for the one-click "Add new group" run. Side effects live in
 * scripts/add-group.mjs; everything here is deterministic and unit-tested. */

/** Ordered steps. Each child step is resume-safe on its own; the progress
 * file only lets a re-run skip steps that already finished. */
export const STEPS = [
  'support',        // one-time: shared router + account service know live approvals / generic admission
  'install',        // create + install + configure 13 services incl. the 200 GB photo store (stays closed)
  'approval-file',  // write the group's opening record (no live change)
  'register',       // register the group CLOSED on the router
  'settings',       // service settings + shared wiring (may need a reload to take effect)
  'reload',         // same-module reload so settings load; never changes code
  'settings-loaded',// settings again; must now pass
  'hashes',         // record the verified module fingerprints in the opening record
  'admission',      // account access for the group's 12 services
  'check',          // full opening checks, group still closed
  'open',           // open to new clubs (revision-checked)
  'approve',        // verify everything and record the live approval on the router
];

export const CONFIRMATION = 'ADD GROUP';
const trim = v => String(v ?? '').trim();
/** Short, forgiving confirmation: surrounding spaces and letter case ignored. */
export function confirmed(value) { return trim(value).toUpperCase() === CONFIRMATION; }

export function validGroupId(id) { return /^g[1-9][0-9]{0,2}$/.test(id) && id !== 'g1'; }

/** Next group id after every known one (folders and registry). */
export function nextGroupId(known) {
  const nums = known.filter(validGroupId).map(id => Number(id.slice(1)));
  const next = Math.max(1, ...nums) + 1;
  if (next > 999) throw new Error('No group ids left');
  return `g${next}`;
}

/** Pick the group to work on: an explicit id, else an unfinished run, else the next id. */
export function chooseGroup(input, progressByGroup, known) {
  const explicit = trim(input).toLowerCase();
  if (explicit && explicit !== 'auto') {
    if (!validGroupId(explicit)) throw new Error('Group id must look like g3 (g1 is the original group)');
    return explicit;
  }
  const unfinished = Object.entries(progressByGroup).filter(([, p]) => p && !p.finishedAt).map(([id]) => id).sort();
  if (unfinished.length > 1) throw new Error(`Several unfinished groups (${unfinished.join(', ')}); type the one to resume`);
  return unfinished[0] ?? nextGroupId(known);
}

/** Resume rules: a finished group is never re-run; code may change between
 * attempts only after the services are installed (later steps re-verify the
 * live fingerprints themselves). */
export function startOrResume(progress, groupId, release, now) {
  if (!/^[a-f0-9]{40}$/.test(release ?? '')) throw new Error('GitHub release binding required');
  if (!progress) return { groupId, release, startedAt: now, completed: [], attempts: 1 };
  if (progress.groupId !== groupId) throw new Error('Progress belongs to another group');
  if (progress.finishedAt) throw new Error(`${groupId} is already added and open; nothing to do`);
  if (progress.release !== release && !progress.completed.includes('install')) {
    throw new Error('Services are part-way through installing with another build; resume from the same commit');
  }
  return { ...progress, release, attempts: (progress.attempts ?? 1) + 1 };
}

export function remainingSteps(progress) { return STEPS.filter(s => !progress.completed.includes(s)); }

export function markDone(progress, step, now) {
  if (!STEPS.includes(step)) throw new Error(`Unknown step ${step}`);
  const completed = progress.completed.includes(step) ? progress.completed : [...progress.completed, step];
  return { ...progress, completed, ...(step === STEPS.at(-1) ? { finishedAt: now } : {}) };
}

/** The group's opening record before fingerprints are recorded. */
export function openingRecord(groupId, provision, shared) {
  if (!validGroupId(groupId) || provision.groupId !== groupId || provision.phase !== 'checked' || !provision.subnetId) {
    throw new Error(`Installed and checked ${groupId} required before writing its opening record`);
  }
  return {
    groupId,
    governor: 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae',
    routerId: shared.shard_router,
    identityAccess: shared.identity_access,
    targetAlias: 'mainnet',
    deploymentId: 'mainnet',
    host: 'https://icp-api.io',
    provisionFile: `../deploy/groups/${groupId}/provision.json`,
    workloadIdentity: shared.secret_workload_identity,
    deploymentRevision: '1',
    primarySubnet: provision.subnetId,
    maxClubs: 100,
    minCycles: '1000000000000',
    heapBudgetBytes: '3221225472',
    services: [],
  };
}

/** The 12 services that check account admission (11 domains + photo store). */
export function admissionTargets(group, domains) {
  const targets = domains.map(name => ({ name, id: group.domains.find(d => d.domain === name)?.canister.toText() }));
  targets.push({ name: 'media_blob_store', id: group.photo_store[0]?.toText() });
  if (targets.some(t => !t.id) || new Set(targets.map(t => t.id)).size !== 12) throw new Error(`Complete 12 ${group.id} admission services required`);
  return targets;
}

/** Only these known, idempotent conditions are retried automatically. */
export function retryable(step, output) {
  if (step === 'reload') return /Registry changed; stop reload/.test(output);
  if (step === 'open' || step === 'approve' || step === 'check') return /changed (before|since)|revision/i.test(output) && !/unknown/i.test(output);
  return false;
}
/** Settings may fail only because the club service has not loaded them yet. */
export function settingsNeedReload(output) { return /SETTINGS_NOT_LOADED/.test(output); }
