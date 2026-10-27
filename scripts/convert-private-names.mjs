// Protected private-name conversion: rewrites readable identity_access display
// names to encrypted PII references. Runs ONLY inside the coordinated
// private-name writer window, which this script drives end-to-end through the
// real identity coordinator (fence sinks -> open writers -> convert -> close
// -> seal -> release). Never a production switch by itself:
//
//   check   : read-only. Pages every profile, splits plaintext vs referenced,
//             writes the plan + 64-char plan hash to the job summary.
//   convert : requires APPROVAL_SCOPE=names, the exact plan hash and typed
//             confirmation; drives the writer window and converts each profile.
//   recover : resumes the per-account journal with the same plan hash.
//
// Safety rules (mirrors migrate-club-bytes.mjs):
// - Randomized ciphertext is journaled before writes and reused verbatim.
//   Never derive randomness from a guessable plaintext name.
// - The stored ciphertext is byte-compared against the journaled
//   encryption BEFORE the reference is published; a mismatch stops the run.
// - Original/club PII writes are single-attempt and pre-journaled unknown;
//   lost replies stop rather than replay. Reference publication is idempotent.
// - Final reconciliation re-pages every profile: zero plaintext names may
//   remain and every reference must bind an inventoried original PII sink.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonical, normalizePlan, normalizeConfirmation, assertMigrationOwner } from './migrate-club-plan.mjs';

export const CONFIRM_CONVERT = 'CONVERT PRIVATE NAMES';
export const CONFIRM_RECOVER = 'RECOVER PRIVATE NAME CONVERSION';
export const NAME_FIELD = 'display_name';
export const REF_PREFIX = 'pii-display-name:v1:';
const PAGE_SIZE = 200;

/** Validate the conversion request; live actions need the names scope. */
export function validateConversionRequest({ action, plan, confirmation, approvalScope }) {
  if (!['check', 'convert', 'recover'].includes(action)) throw Error('Action must be check, convert or recover');
  if (action === 'check') return;
  if (approvalScope !== 'names') throw Error('Separate names conversion approval is required');
  if (normalizePlan(plan).length !== 64) throw Error('Paste the 64-character plan hash from the check run');
  const want = action === 'convert' ? CONFIRM_CONVERT : CONFIRM_RECOVER;
  if (normalizeConfirmation(confirmation) !== want) throw Error(`Type ${want}`);
}

/** Names approval binds the exact plan; owner gate matches club migration. */
export function assertNamesApproval(approval, planHash) {
  validateConversionRequest(approval ?? {});
  if (approval.action === 'check' || approval.approvalScope !== 'names' || normalizePlan(approval.plan) !== planHash) {
    throw Error('Separate names conversion approval must match this plan');
  }
}

/**
 * Pure plan: one row per profile still holding a plaintext display name.
 * Refuses rows with no usable principal (a reference could never bind them)
 * and rows whose reference would point outside the inventoried sinks.
 */
export function planConversions({ profiles, sinks }) {
  const sinkSet = new Set(sinks);
  const rows = [];
  for (const p of profiles) {
    if (p.display_name.startsWith('pii-display-name:')) {
      const parts = p.display_name.split(':');
      if (parts.length !== 4 || parts[1] !== 'v1' || !sinkSet.has(parts[2])) {
        throw Error(`Profile ${p.account_id} references a sink outside the inventory; reconcile before converting`);
      }
      continue; // already converted
    }
    const subject = p.principals?.[0];
    if (!subject) throw Error(`Profile ${p.account_id} has no principal; its reference could never bind`);
    if (!p.display_name.trim()) throw Error(`Profile ${p.account_id} has an empty display name; set one before converting`);
    rows.push({ accountId: p.account_id, name: p.display_name, subject });
  }
  rows.sort((a, b) => a.accountId < b.accountId ? -1 : 1);
  return rows;
}

/** Plan hash binds the exact plaintext rows and the sink inventory. */
export function buildConversionPlan({ rows, sinks, historyRevision }) {
  const body = {
    kind: 'private-name-conversion', historyRevision: String(historyRevision ?? ''),
    sinks: [...sinks].sort(),
    rows: rows.map(r => ({ accountId: r.accountId, name: r.name, subject: r.subject, ...(r.clubs ? { clubs: [...r.clubs].sort(), clubNameScheme: 'vetkey-club-names-v1' } : {}) })),
  };
  return { body, hash: createHash('sha256').update(canonical(body)).digest('hex') };
}

/**
 * Randomized IBE encryption; journal encrypted bytes before writing.
 */
export async function encryptName(publicKey, subject, name) {
  const { DerivedPublicKey, IbeCiphertext, IbeIdentity, IbeSeed } = await import(new URL('../frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js', import.meta.url).href);
  return IbeCiphertext.encrypt(
    DerivedPublicKey.deserialize(Uint8Array.from(publicKey)),
    IbeIdentity.fromBytes(new TextEncoder().encode(`${subject}${NAME_FIELD}`)),
    new TextEncoder().encode(name),
    IbeSeed.random(),
  ).serialize();
}

export function nameReference(sink, subject) { return `${REF_PREFIX}${sink}:${subject}`; }

/** Explicit destination list supplied by a verified inventory adapter, never
 * inferred from names/paths. This helper does not approve or execute rollout. */
export async function encryptClubName(publicKey, club, subject, name) {
  if (!club || club.length > 64 || /[\u001f/]/.test(club)) throw Error('Invalid exact club');
  const { DerivedPublicKey, IbeCiphertext, IbeIdentity, IbeSeed } = await import(new URL('../frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js', import.meta.url).href);
  const input = `clubnames:${club}\u001f${NAME_FIELD}`;
  return IbeCiphertext.encrypt(DerivedPublicKey.deserialize(Uint8Array.from(publicKey)), IbeIdentity.fromBytes(new TextEncoder().encode(input)), new TextEncoder().encode(name), IbeSeed.random()).serialize();
}

export async function prepareClubNameCopies(sink, publicKey, row, { pii, journal }) {
  if (!Array.isArray(row.clubs) || row.clubs.length > 100 || new Set(row.clubs).size !== row.clubs.length) throw Error('Bounded distinct exact club inventory required');
  for (const club of [...row.clubs].sort()) {
    const id = `${row.accountId}:club:${club}`;
    const prior = journal.get(id);
    const ciphertext = prior?.ciphertext ?? Array.from(await encryptClubName(publicKey, club, row.subject, row.name));
    const hash = createHash('sha256').update(Uint8Array.from(ciphertext)).digest('hex');
    if (prior && (prior.hash !== hash || prior.sink !== sink || prior.subject !== row.subject || prior.club !== club)) throw Error('Club name journal binding changed');
    if (prior?.phase === 'unknown') throw Error('Unknown club name write retained; read back before retrying');
    // Always read completed copies again: stale bytes cannot certify conversion.
    if (!prior) {
      journal.put(id, { phase: 'unknown', sink, subject: row.subject, club, hash, ciphertext });
      await pii.register_private_club_name(row.subject, club, ciphertext);
      journal.put(id, { phase: 'registered', sink, subject: row.subject, club, hash, ciphertext });
    }
    const stored = await pii.read_private_club_name_preparation(row.subject, club);
    if (stored.master_key_id !== `vetkey-club-names-v1:${club}` || stored.ciphertext.length !== ciphertext.length || ciphertext.some((b, i) => b !== stored.ciphertext[i])) throw Error('Club name ciphertext readback mismatch');
    journal.put(id, { phase: 'verified', sink, subject: row.subject, club, hash, ciphertext });
  }
}

/** File-backed per-account journal; plaintext names are never persisted. */
export function conversionJournal(path) {
  let entries = {};
  try { entries = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw Error('Conversion journal is unreadable; refuse overwrite'); }
  const flush = () => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(entries, null, 2), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  };
  return {
    get: (id) => entries[id],
    put: (id, v) => { entries[id] = { ...entries[id], ...v }; flush(); },
    ids: () => Object.keys(entries),
  };
}

/**
 * Convert one planned account. `deps` are injected so tests never touch a
 * network: { pii, identity, journal }. Phases: encrypted -> registered ->
 * verified -> converted. A prior 'unknown' phase stops the run for manual
 * reconciliation; completed accounts return immediately.
 */
export async function convertOneAccount(sink, publicKey, row, deps) {
  const { pii, identity, journal } = deps;
  const reference = nameReference(sink, row.subject);
  const prior = journal.get(row.accountId);
  if (prior && (prior.sink !== sink || prior.subject !== row.subject)) throw Error('Conversion journal binding changed');
  if (prior?.phase === 'converted') return reference;
  if (prior && !['encrypted', 'registered', 'verified'].includes(prior.phase)) {
    throw Error(`Unknown outcome retained for ${row.accountId} at phase ${prior.phase}; reconcile before retrying`);
  }

  if (prior && !prior.ciphertext) throw Error('Legacy conversion journal needs reconciliation');
  const ciphertext = prior?.ciphertext ?? Array.from(await encryptName(publicKey, row.subject, row.name));
  const hash = createHash('sha256').update(Uint8Array.from(ciphertext)).digest('hex');
  if (prior && prior.hash !== hash) throw Error('Conversion ciphertext journal changed');
  if (!prior || prior.phase === 'encrypted') {
    // Persist unknown BEFORE a write; lost replies must never erase existing
    // club copies by replaying the original record registration.
    journal.put(row.accountId, { phase: 'unknown', hash, subject: row.subject, sink, ciphertext });
    await pii.register_pii(row.subject, NAME_FIELD, ciphertext, row.subject);
    journal.put(row.accountId, { phase: 'registered', hash, subject: row.subject, sink, ciphertext });
  }

  const readback = await pii.get_encrypted_pii_batch([row.subject], NAME_FIELD, 'profile_display', 'conversion readback');
  const stored = readback?.[0]?.ciphertext;
  if (!stored || stored.length !== ciphertext.length || ciphertext.some((b, i) => stored[i] !== b)) {
    throw Error(`Stored ciphertext mismatch for ${row.accountId}; refusing to publish the reference`);
  }
  journal.put(row.accountId, { phase: 'verified', hash, subject: row.subject, sink, ciphertext });

  if (row.clubs) await prepareClubNameCopies(sink, publicKey, row, { pii, journal });

  let profile;
  try {
    profile = await identity.convert_profile_name(row.accountId, reference);
  } catch {
    profile = await identity.convert_profile_name(row.accountId, reference); // idempotent on success
  }
  if (profile?.display_name !== reference) throw Error(`Profile ${row.accountId} did not adopt the exact reference`);
  journal.put(row.accountId, { phase: 'converted', hash, subject: row.subject, sink, ciphertext });
  return reference;
}

/**
 * Drive the coordinated writer window around a batch of account conversions.
 * `coordinator` wraps the identity actor: begin/advance/close/read. Every
 * sink must fence before any writer opens; every writer must seal before any
 * sink releases. The window id is stable so an interrupted run resumes the
 * same journaled operation instead of opening a second one.
 */
export async function withConversionWindow(coordinator, operationId, historyRevision, fn) {
  let w = await coordinator.begin(operationId, historyRevision);
  const advanceAll = async (targets) => { for (const t of targets) w = await coordinator.advance(operationId, t); };
  if (w.phase === 'Fencing') await advanceAll(w.sinks);
  if (w.phase === 'Opening') await advanceAll(w.writers.filter(t => !w.opened.some(r => r.receiver === t)));
  if (w.phase !== 'Writing' && w.phase !== 'Closing' && w.phase !== 'Releasing' && w.phase !== 'Done') {
    throw Error(`Window is in unexpected phase ${w.phase}`);
  }
  if (w.phase === 'Writing') {
    await fn();
    w = await coordinator.close(operationId);
  }
  if (w.phase === 'Closing') await advanceAll(w.writers.filter(t => !w.sealed.some(r => r.receiver === t)));
  if (w.phase === 'Releasing') await advanceAll(w.sinks.filter(t => !w.completed.some(r => r.receiver === t)));
  const final = await coordinator.read(operationId);
  if (final.phase !== 'Done') throw Error(`Window did not complete; phase ${final.phase}`);
  return final;
}

/** Final reconciliation: no plaintext names remain; references bind sinks. */
export function reconcileConversion({ profiles, sinks }) {
  const sinkSet = new Set(sinks);
  const problems = [];
  let converted = 0;
  for (const p of profiles) {
    if (!p.display_name.startsWith(REF_PREFIX)) { problems.push(`${p.account_id} still plaintext`); continue; }
    const parts = p.display_name.split(':');
    if (parts.length !== 4 || parts[1] !== 'v1' || !sinkSet.has(parts[2])) problems.push(`${p.account_id} reference outside inventory`);
    else converted += 1;
  }
  return { converted, problems };
}

// ---- Live wiring (only used by the protected workflow runner) ----

async function liveDeps(env) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { HttpAgent, Actor } = require('@dfinity/agent');
  const { Secp256k1KeyIdentity } = require('@dfinity/identity-secp256k1');
  const pem = readFileSync(String(env.DEPLOY_IDENTITY_PEM ?? ''), 'utf8');
  const identity = Secp256k1KeyIdentity.fromPem(pem);
  const agent = new HttpAgent({ host: 'https://ic0.app', identity });
  const identityId = String(env.IDENTITY_ACCESS_CANISTER ?? '').trim();
  const piiId = String(env.PII_ACCESS_CONTROL_CANISTER ?? '').trim();
  if (!identityId || !piiId) throw Error('IDENTITY_ACCESS_CANISTER and PII_ACCESS_CONTROL_CANISTER are required');
  const idl = (path) => require(path).idlFactory;
  const root = join(dirname(new URL(import.meta.url).pathname), '..');
  const identityActor = Actor.createActor(idl(join(root, 'frontend/src/lab/bindings/identity_access/declarations/identity_access.did.js')), { agent, canisterId: identityId });
  const piiActor = Actor.createActor(idl(join(root, 'frontend/src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js')), { agent, canisterId: piiId });
  const unwrap = async (p, label) => { const r = await p; if (r && 'Err' in r) throw Error(`${label} refused: ${r.Err}`); return r?.Ok; };
  return {
    identityId, piiId,
    identity: {
      list: (cursor, limit) => unwrap(identityActor.list_profiles_for_conversion(cursor ? [cursor] : [], limit), 'List profiles'),
      convert_profile_name: (accountId, reference) => unwrap(identityActor.convert_profile_name(accountId, reference), 'Convert profile name'),
      begin: (op, rev) => unwrap(identityActor.begin_private_name_write_window(op, BigInt(rev)), 'Begin window'),
      advance: (op, target) => unwrap(identityActor.advance_private_name_write_window(op, target), 'Advance window'),
      close: (op) => unwrap(identityActor.close_private_name_write_window(op), 'Close window'),
      read: (op) => unwrap(identityActor.read_private_name_write_window(op), 'Read window'),
      revision: async () => Number((await unwrap(identityActor.read_removal_history_manifest(), 'Read history')).revision),
    },
    pii: {
      register_pii: (id, field, ct, owner) => unwrap(piiActor.register_pii(id, field, ct, owner), 'Register PII'),
      get_encrypted_pii_batch: (ids, field, ctx2, label) => unwrap(piiActor.get_encrypted_pii_batch(ids, field, ctx2, label), 'Read back PII'),
      verification_key: async () => Uint8Array.from(await piiActor.pii_vetkey_verification_key()),
    },
  };
}

async function pageAllProfiles(identity) {
  const profiles = [];
  let cursor;
  for (;;) {
    const page = await identity.list(cursor, PAGE_SIZE);
    profiles.push(...page.rows);
    if (!page.next?.length) return profiles;
    cursor = page.next[0];
    if (profiles.length > 100000) throw Error('Profile inventory exceeds conversion budget');
  }
}

export async function main(env = process.env) {
  const req = { action: env.ACTION, plan: env.PLAN, confirmation: env.CONFIRMATION, approvalScope: env.APPROVAL_SCOPE };
  validateConversionRequest(req);
  // The old runner rebuilds a plaintext-only plan and supplies no complete
  // club inventory. Do not allow that path to masquerade as a club-key rollout.
  // Offline artifact helpers do not yet supply authenticated release evidence.
  if (req.action !== 'check') throw Error('Club-key live conversion is blocked: complete authenticated inventory, protected artifact transport and release acceptance are required');
  assertMigrationOwner(req.action === 'check' ? 'check' : 'migrate', env);
  const deps = await liveDeps(env);
  const journalPath = join(dirname(new URL(import.meta.url).pathname), '.private-name-conversion', 'journal.json');

  if (req.action === 'check') {
    const profiles = await pageAllProfiles(deps.identity);
    const revision = await deps.identity.revision();
    const rows = planConversions({ profiles, sinks: [deps.piiId] });
    const plan = buildConversionPlan({ rows, sinks: [deps.piiId], historyRevision: revision });
    console.log(`Profiles: ${profiles.length} total, ${rows.length} plaintext to convert`);
    console.log(`Plan hash: ${plan.hash}`);
    return plan;
  }

  const journal = conversionJournal(journalPath);
  const profiles = await pageAllProfiles(deps.identity);
  const revision = await deps.identity.revision();
  const rows = planConversions({ profiles, sinks: [deps.piiId] });
  const plan = buildConversionPlan({ rows, sinks: [deps.piiId], historyRevision: revision });
  assertNamesApproval(req, plan.hash);

  const publicKey = await deps.pii.verification_key();
  const operationId = `conversion-${plan.hash.slice(0, 16)}`;
  await withConversionWindow(deps.identity, operationId, revision, async () => {
    for (const row of rows) await convertOneAccount(deps.piiId, publicKey, row, { pii: deps.pii, identity: deps.identity, journal });
  });

  const after = await pageAllProfiles(deps.identity);
  const report = reconcileConversion({ profiles: after, sinks: [deps.piiId] });
  if (report.problems.length) throw Error(`Reconciliation failed: ${report.problems.join('; ')}`);
  console.log(`Converted ${report.converted} profiles to encrypted references; no plaintext names remain.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(`Failed: ${e.message}`); process.exit(1); });
