// Move ONE whole club from Supabase into a chosen canister group.
// Runs only in the migrate-club GitHub workflow (service key + deploy key
// never reach a browser). The Supabase copy is only ever read.
//
//   ACTION=check|migrate|recover CLUB_ID=<uuid> GROUP_ID=g2 [PLAN=<hash>] [CONFIRMATION=...]
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (read-only use)
//
// check   : read-only inventory + gates + plan hash, written to the job summary.
// migrate : requires the exact plan hash; journals each step page and stops on
//           any unknown outcome. Routing switches only after verification.
// recover : resumes a journal with the same plan hash.
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { STEPS, validateRequest, assertMigrationOwner, assertMigrationApproval, gateReasons, buildPlan, newJournal, nextAction, normalizePlan, recordIntent, recordReply } from './migrate-club-plan.mjs';
import { createPrivateKey } from 'node:crypto';
import { sendClaimInvites } from './migrate-club-claims.mjs';

const root = process.env.GITHUB_WORKSPACE || join(dirname(fileURLToPath(import.meta.url)), '..');

/** Target group canisters from the checked mainnet inventory (g1 = base mapping). */
export function loadGroup(groupId) {
  if (groupId === 'g1') {
    const ids = JSON.parse(readFileSync(join(root, 'deploy/mainnet/.icp/data/mappings/ic.ids.json'), 'utf8'));
    return { groupId, canisters: ids, mediaStore: ids.media_blob_store ?? null };
  }
  const path = join(root, 'deploy/groups', groupId, 'provision.json');
  if (!existsSync(path)) return null;
  const g = JSON.parse(readFileSync(path, 'utf8'));
  if (g.deploymentId !== 'mainnet' || g.groupId !== groupId) throw Error(`Invalid inventory for ${groupId}`);
  return { groupId, canisters: g.canisters, mediaStore: g.dedicatedBlobStore?.canisterId ?? g.canisters?.media_blob_store ?? null };
}

export function allGroupIds() {
  const ids = ['g1'];
  const dir = join(root, 'deploy/groups');
  if (existsSync(dir)) for (const name of execSync(`ls ${JSON.stringify(dir)}`).toString().split('\n')) if (/^g\d+$/.test(name) && name !== 'g1' && existsSync(join(dir, name, 'provision.json'))) ids.push(name);
  return ids;
}

function supabase() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function rows(table, query) {
    const r = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
    if (!r.ok) throw Error(`${table}: ${r.status} ${await r.text()}`);
    return r.json();
  }
  async function count(table, query) {
    const r = await fetch(`${url}/rest/v1/${table}?select=*&${query}`, { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } });
    if (!r.ok && r.status !== 206) throw Error(`${table}: ${r.status}`);
    const total = Number((r.headers.get('content-range') ?? '').split('/')[1]);
    if (!Number.isFinite(total)) throw Error(`${table}: count unavailable`);
    return total;
  }
  /** Every row of `table` where `col` = value, paged so large clubs are complete. */
  async function all(table, query) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const r = await fetch(`${url}/rest/v1/${table}?select=*&${query}&order=id`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
      if (!r.ok) throw Error(`${table}: ${r.status} ${await r.text()}`);
      const page = await r.json(); out.push(...page);
      if (page.length < 1000) return out;
    }
  }
  return { rows, count, all };
}

const inList = ids => `in.(${ids.map(i => `"${i}"`).join(',')})`;

/** Read-only inventory of one club across every mapped table. */
export async function inventoryClub(clubId, db = supabase()) {
  const club = await db.rows('clubs', `select=id,name&id=eq.${clubId}`);
  if (!club.length) return { clubFound: false, counts: {}, mediaFiles: 0, mediaBytes: 0 };
  const teams = (await db.rows('teams', `select=id&club_id=eq.${clubId}`)).map(t => t.id);
  const events = (await db.rows('events', `select=id&club_id=eq.${clubId}`)).map(e => e.id);
  const ids = { club: [clubId], team: teams, event: events };
  const counts = {};
  for (const step of STEPS) for (const [table, column, via] of step.tables) {
    let total = 0;
    for (let i = 0; i < ids[via].length; i += 100) total += await db.count(table, `${column}=${inList(ids[via].slice(i, i + 100))}`);
    counts[table] = total;
  }
  let mediaFiles = 0, mediaBytes = 0;
  for (const table of ['photos', 'vault_files']) {
    for (let from = 0; ; from += 1000) {
      const page = await db.rows(table, `select=file_size&club_id=eq.${clubId}&order=id&limit=1000&offset=${from}`);
      mediaFiles += page.length; mediaBytes += page.reduce((s, r) => s + (Number(r.file_size) || 0), 0);
      if (page.length < 1000) break;
    }
  }
  return { clubFound: true, clubName: club[0].name, counts, mediaFiles, mediaBytes };
}

/** Public website endpoint: does any group already hold this club? */
export async function findClubOnChain(clubId, groups) {
  for (const g of groups) {
    const id = g.canisters?.club_domain;
    if (!id) return null;
    let r;
    try { r = await fetch(`https://${id}.raw.icp0.io/club?id=${encodeURIComponent(clubId)}&scope=club`); } catch { return null; }
    if (r.status === 200) return g.groupId;
    if (r.status !== 404) return null; // unknown -> refuse
  }
  return false;
}

async function readUsage(target) {
  const require = createRequire(import.meta.url);
  const { HttpAgent, Actor, AnonymousIdentity } = require('@dfinity/agent');
  const agent = new HttpAgent({ host: 'https://ic0.app', identity: new AnonymousIdentity(), shouldSyncTime: true });
  const idl = ({ IDL }) => IDL.Service({ memory_stats: IDL.Func([], [IDL.Record({ heap_bytes: IDL.Nat, memory_bytes: IDL.Nat, stable_bytes: IDL.Nat })], ['query']) });
  const usage = {};
  const services = { ...target.canisters, media_blob_store: target.mediaStore };
  for (const [svc, id] of Object.entries(services)) {
    if (!id) continue;
    try { usage[svc] = Number((await Actor.createActor(idl, { agent, canisterId: id }).memory_stats()).memory_bytes); } catch { /* unreadable -> gate refuses */ }
  }
  return usage;
}

// Destination writers live in migrate-club-writers.mjs; steps without one make
// `migrate` refuse BEFORE any write.
export { WRITERS } from './migrate-club-writers.mjs';
import { WRITERS, snapshotType } from './migrate-club-writers.mjs';
import { reconcileClub } from './migrate-club-reconcile.mjs';
import { pullJournal, pushJournal } from './migrate-club-remote.mjs';

function summary(md) { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); console.log(md); }

export async function main(env = process.env) {
  const req = { action: env.ACTION, clubId: env.CLUB_ID?.trim(), groupId: env.GROUP_ID?.trim(), plan: env.PLAN, confirmation: env.CONFIRMATION, approvalScope: env.APPROVAL_SCOPE };
  validateRequest(req);
  assertMigrationOwner(req.action, env);
  const target = loadGroup(req.groupId);
  if (req.action === 'invite') return invite(req, target);
  const groups = allGroupIds().map(loadGroup).filter(Boolean);
  const inventory = await inventoryClub(req.clubId);
  const clubOnChain = await findClubOnChain(req.clubId, groups);
  const limits = JSON.parse(readFileSync(join(root, 'deploy/groups/tested-limits.json'), 'utf8')).storageLimitBytes ?? {};
  const usage = target ? await readUsage(target) : {};
  const reasons = gateReasons({ inventory, target, clubOnChain, usage, limits });
  const revision = env.GITHUB_SHA ?? 'local';
  const { body, hash } = buildPlan({ clubId: req.clubId, groupId: req.groupId, revision, inventory, target });

  summary(`## Club migration ${req.action}: ${inventory.clubName ?? req.clubId} → ${req.groupId}`);
  summary(`| Table | Rows |\n|---|---|\n${Object.entries(body.counts).map(([t, n]) => `| ${t} | ${n} |`).join('\n')}`);
  summary(`Files to copy: ${inventory.mediaFiles} (${(inventory.mediaBytes / 1e6).toFixed(1)} MB). Supabase copy stays untouched.`);
  if (reasons.length) { summary(`### Blocked\n${reasons.map(r => `- ${r}`).join('\n')}`); process.exitCode = 1; return; }
  summary(`### Plan hash\n\`${hash}\``);

  const dir = join(root, '.migration-journal'); mkdirSync(dir, { recursive: true });
  const invPath = join(dir, `${req.clubId}.inventory.json`);
  if (req.action === 'check') {
    // Stable source inventory: the recorded plan hash binds every table count,
    // so a later migrate/recover on changed source data fails the hash check.
    writeFileSync(invPath, JSON.stringify({ clubId: req.clubId, groupId: req.groupId, revision, planHash: hash, capturedAt: new Date().toISOString() }, null, 2));
    return;
  }

  if (normalizePlan(req.plan) !== hash) throw Error('Plan changed since the check; run check again on this revision');
  if (!existsSync(invPath)) throw Error('No recorded check inventory for this club; run check first on this revision');
  const recorded = JSON.parse(readFileSync(invPath, 'utf8'));
  if (recorded.planHash !== hash) throw Error('Source data changed since the recorded check; run check again and use the new plan hash');
  const missing = STEPS.filter(s => !WRITERS[s.id]).map(s => s.id);
  if (missing.length) throw Error(`Refusing before any write: destination writers not ready for ${missing.join(', ')}`);

  const path = join(dir, `${req.clubId}.json`);
  let journal;
  if (existsSync(path)) {
    journal = JSON.parse(readFileSync(path, 'utf8'));
  } else if (req.action === 'recover') {
    // Runner lost its disk: restore the durable remote copy, hash-verified.
    const remote = await pullJournal(env, req.clubId);
    if (!remote) throw Error('No local or remote journal to recover');
    journal = remote.journal;
    writeFileSync(path, JSON.stringify(journal, null, 2));
  } else {
    journal = newJournal(hash);
  }
  if (journal.planHash !== hash) throw Error('Journal belongs to a different plan');
  if (req.action === 'migrate' && Object.keys(journal.steps).length) throw Error('A journal exists; use recover');
  const next = nextAction(journal);
  if (next.blocked) throw Error(next.blocked);
  writeFileSync(path, JSON.stringify(journal, null, 2));
  await runSteps({
    journal, path, ctx: writerContext(req.clubId, target), approval: req,
    // Durable remote recovery: every acknowledged state is mirrored to the
    // journal branch and read back; a failed push stops the run (unknown).
    onSave: async (j) => { await pushJournal(env, req.clubId, j); },
  });
}

/** Claimed Supabase user -> principal pairs on the destination club service. */
async function claimedAccounts(ctx) {
  const { IDL } = ctx.require('@icp-sdk/core/candid');
  const { Actor } = ctx.require('@icp-sdk/core/agent');
  const Claimed = IDL.Record({ source_user: IDL.Text, principal: IDL.Principal, claimed_ms: IDL.Nat64 });
  const actor = Actor.createActor(({ IDL }) => IDL.Service({
    export_account_claims: IDL.Func([IDL.Text, IDL.Nat, IDL.Nat], [IDL.Variant({ Ok: IDL.Vec(Claimed), Err: IDL.Text })], ['query']),
  }), { agent: ctx.agent, canisterId: ctx.target.canisters.club_domain });
  const out = new Map();
  for (let offset = 0; ; offset += 500) {
    const r = await actor.export_account_claims(ctx.clubId, BigInt(offset), 500n);
    if ('Err' in r) throw Error(`Claim read refused: ${r.Err}`);
    for (const c of r.Ok) out.set(c.source_user, c.principal);
    if (r.Ok.length < 500) return out;
  }
}

async function invite(req, target) {
  if (!target?.canisters?.club_domain) throw Error('Target group has no club service');
  const appUrl = process.env.ICP_EMAIL_APP_URL, from = process.env.ICP_EMAIL_FROM, resend = process.env.RESEND_API_KEY;
  if (!appUrl || !from || !resend) throw Error('ICP_EMAIL_APP_URL, ICP_EMAIL_FROM and RESEND_API_KEY are required');
  const ctx = writerContext(req.clubId, target);
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { IDL } = ctx.require('@icp-sdk/core/candid');
  const { Actor } = ctx.require('@icp-sdk/core/agent');
  const Reg = IDL.Record({ token_hash: IDL.Text, source_user: IDL.Text, email_hint: IDL.Text, expires_ms: IDL.Nat64 });
  const club = Actor.createActor(({ IDL }) => IDL.Service({
    register_account_claims: IDL.Func([IDL.Text, IDL.Vec(Reg)], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
  }), { agent: ctx.agent, canisterId: target.canisters.club_domain });
  const db = supabase();
  const r = await sendClaimInvites({
    clubId: req.clubId, group: req.groupId, approval: req, appUrl, now: Date.now(), db,
    claimedUsers: async () => [...(await claimedAccounts(ctx)).keys()],
    authEmail: async (id) => {
      const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(id)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!res.ok) return null;
      const u = await res.json();
      return u.email_confirmed_at ? u.email : null; // verified addresses only
    },
    registerPage: async (rows) => { const x = await club.register_account_claims(req.clubId, rows); if ('Err' in x) throw Error(`Claim registration refused: ${x.Err}`); },
    sendEmail: async ({ to, subject, text }) => {
      const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text }) });
      if (!res.ok) throw Error(`Email ${res.status}`);
    },
  });
  summary(`## Account claim emails → ${req.groupId}\n| Members | Already linked | Sent | No verified email | Failed |\n|---|---|---|---|---|\n| ${r.members} | ${r.alreadyLinked} | ${r.sent} | ${r.noEmail} | ${r.failed} |`);
}

/** Signed context for writers: deploy identity agent + exact-club Supabase reads. */
function writerContext(clubId, target) {
  const require = createRequire(join(root, 'frontend/package.json'));
  const { HttpAgent } = require('@icp-sdk/core/agent');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  if (!process.env.DEPLOYER_PEM) throw Error('DEPLOYER_PEM is required to write');
  const jwk = createPrivateKey(process.env.DEPLOYER_PEM.replace(/\r/g, '').replace(/\\n/g, '\n')).export({ format: 'jwk' });
  const secret = new Uint8Array(Buffer.from(jwk.d, 'base64url'));
  const identity = jwk.kty === 'OKP' ? Ed25519KeyIdentity.fromSecretKey(secret) : Secp256k1KeyIdentity.fromSecretKey(secret);
  const db = supabase();
  return {
    require, target, clubId, creator: identity.getPrincipal(),
    agent: HttpAgent.createSync({ host: 'https://icp-api.io', identity }),
    rows: (table, col) => db.all(table, `${col}=eq.${encodeURIComponent(clubId)}`),
    rowsIn: async (table, col, ids) => { const out = []; for (let i = 0; i < ids.length; i += 100) out.push(...await db.all(table, `${col}=${inList(ids.slice(i, i + 100))}`)); return out; },
    claims: null, // read from this exact destination before member-owned steps
    schemaFile: (domain) => new URL(`./migrate-schemas/${domain}.snapshot.did.js`, import.meta.url).href,
    // Byte copy-and-encrypt support (media_bytes step).
    download: async (sourcePath) => {
      const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const href = /^https?:\/\//.test(sourcePath) ? sourcePath : `${url}/storage/v1/object/${sourcePath}`;
      const res = await fetch(href, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!res.ok) throw Error(`Download ${sourcePath} failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    blobStoreActor: () => {
      const { IDL } = require('@icp-sdk/core/candid');
      const { Actor } = require('@icp-sdk/core/agent');
      const canisterId = target.canisters.media_blob_store;
      if (!canisterId) throw Error('Destination media_blob_store missing');
      const agent = HttpAgent.createSync({ host: 'https://icp-api.io', identity });
      const actor = Actor.createActor(({ IDL }) => IDL.Service({
        begin_upload: IDL.Func([IDL.Text, IDL.Text, IDL.Nat64, IDL.Nat32], [IDL.Variant({ Ok: IDL.Text, Err: IDL.Text })], []),
        put_chunk: IDL.Func([IDL.Text, IDL.Nat32, IDL.Vec(IDL.Nat8)], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
        finalize_upload: IDL.Func([IDL.Text], [IDL.Variant({ Ok: IDL.Record({ canister: IDL.Text, path: IDL.Text, content_hash: IDL.Text }), Err: IDL.Text })], []),
        abort_upload: IDL.Func([IDL.Text], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
      }), { agent, canisterId });
      const unwrap = async (p, label) => { const r = await p; if (r && 'Err' in r) throw Error(`${label} refused: ${r.Err}`); return r?.Ok; };
      return {
        begin_upload: (path, mime, size, chunks) => unwrap(actor.begin_upload(path, mime, size, chunks), 'Begin blob upload'),
        put_chunk: (id, i, data) => unwrap(actor.put_chunk(id, i, Array.from(data)), `Upload blob chunk ${i}`),
        finalize_upload: (id) => unwrap(actor.finalize_upload(id), 'Finalize blob upload'),
        abort_upload: (id) => unwrap(actor.abort_upload(id), 'Abort blob upload'),
      };
    },
    piiActor: () => {
      const { IDL } = require('@icp-sdk/core/candid');
      const { Actor } = require('@icp-sdk/core/agent');
      const canisterId = target.canisters.pii_access_control;
      if (!canisterId) throw Error('Destination pii_access_control missing');
      const agent = HttpAgent.createSync({ host: 'https://icp-api.io', identity });
      const actor = Actor.createActor(({ IDL }) => IDL.Service({
        register_pii: IDL.Func([IDL.Text, IDL.Text, IDL.Vec(IDL.Nat8), IDL.Principal], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
        grant_pii_read_club: IDL.Func([IDL.Text, IDL.Text, IDL.Text], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
      }), { agent, canisterId });
      const { Principal } = require('@icp-sdk/core/principal');
      const unwrap = async (p, label) => { const r = await p; if (r && 'Err' in r) throw Error(`${label} refused: ${r.Err}`); return r?.Ok; };
      return {
        register_pii: (id, field, marker, owner) => unwrap(actor.register_pii(id, field, marker, Principal.fromText(owner)), 'Register PII'),
        grant_pii_read_club: (id, field, club) => unwrap(actor.grant_pii_read_club(id, field, club), 'Grant club read'),
      };
    },
    byteJournal: byteJournal(join(root, 'scripts', '.migrate-bytes-cache', `${clubId}.json`)),
  };
}

/** File-backed per-item byte journal; plaintext is never persisted. */
function byteJournal(path) {
  let entries = {};
  try { entries = JSON.parse(readFileSync(path, 'utf8')); } catch { /* first run */ }
  const flush = () => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(entries, null, 2)); };
  return {
    get: (id) => entries[id],
    put: (id, v) => { entries[id] = { ...entries[id], ...v }; flush(); },
  };
}

/** Executes writer steps in journal order; a lost reply is recorded as unknown and stops the run. */
export { claimedAccounts };

/** Read back one domain's decoded snapshot; messaging exports page by page. */
export async function readSnapshot(ctx, domain) {
  const { IDL } = ctx.require('@icp-sdk/core/candid');
  const { Actor } = ctx.require('@icp-sdk/core/agent');
  const canisterId = ctx.target.canisters[domain];
  if (!canisterId) throw Error(`Destination ${domain} missing`);
  const type = await snapshotType(ctx.require, ctx.schemaFile(domain));
  const decode = (blob) => IDL.decode([type], Buffer.from(blob))[0];
  if (domain === 'messaging_domain') {
    const actor = Actor.createActor(({ IDL }) => IDL.Service({
      export_club_snapshot_page: IDL.Func([IDL.Text, IDL.Nat, IDL.Nat], [IDL.Variant({ Ok: IDL.Vec(IDL.Nat8), Err: IDL.Text })], []),
    }), { agent: ctx.agent, canisterId });
    const merged = { conversations: [], messages: [] };
    for (let offset = 0; ; offset += 1) {
      const r = await actor.export_club_snapshot_page(ctx.clubId, BigInt(offset), 1n);
      if ('Err' in r) throw Error(`messaging export refused: ${r.Err}`);
      const page = decode(r.Ok);
      merged.conversations.push(...(page.conversations ?? []));
      merged.messages.push(...(page.messages ?? []));
      if (!(page.conversations?.length) && !(page.messages?.length)) return merged;
    }
  }
  const actor = Actor.createActor(({ IDL }) => IDL.Service({
    export_club_snapshot: IDL.Func([IDL.Text], [IDL.Variant({ Ok: IDL.Vec(IDL.Nat8), Err: IDL.Text })], []),
  }), { agent: ctx.agent, canisterId });
  const r = await actor.export_club_snapshot(ctx.clubId);
  if ('Err' in r) throw Error(`${domain} export refused: ${r.Err}`);
  return decode(r.Ok);
}

export async function runSteps({ journal, path, ctx, approval, writers = WRITERS, save = (j) => writeFileSync(path, JSON.stringify(j, null, 2)), onSave = async () => {} }) {
  assertMigrationApproval(approval, 'data', ctx.clubId, ctx.target?.groupId, journal.planHash);
  const persist = async (j) => { save(j); await onSave(j); };
  for (;;) {
    const next = nextAction(journal);
    if (next.done || next.blocked) { if (next.blocked) throw Error(next.blocked); return journal; }
    if (next.step === 'route') throw Error('Data migration approval does not authorize sign-in/routing cutover; separate authentication approval is required');
    if (next.step === 'verify') {
      journal = recordIntent(journal, next.step, next.page); await persist(journal);
      try {
        const report = await reconcileClub(ctx, journal, { readSnapshot: (d) => readSnapshot(ctx, d) });
        summary(`### Reconciliation\n| Domain | Expected | On-chain | OK |\n|---|---|---|---|\n${report.map((r) => `| ${r.domain} | ${r.expected} | ${r.actual} | ${r.ok ? 'yes' : 'NO'} |`).join('\n')}`);
      } catch (e) { journal = recordReply(journal, next.step, next.page, { unknown: true }); await persist(journal); throw e; }
      journal = recordReply(journal, next.step, next.page, { ok: true, last: true }); await persist(journal);
      continue;
    }
    const write = writers[next.step];
    if (!write) return journal;
    if (['children', 'events', 'rewards', 'messaging', 'notifications', 'media', 'vault', 'media_bytes'].includes(next.step) && !ctx.claims) {
      ctx.claims = await (ctx.readClaims ? ctx.readClaims() : claimedAccounts(ctx));
    }
    journal = recordIntent(journal, next.step, next.page); await persist(journal);
    let reply;
    try { const r = await write(ctx); reply = { ok: true, last: true, counts: r.counts }; summary(`- ${next.step}: ${r.records} records loaded`); }
    catch (e) { reply = /refused|missing/.test(e.message) ? { ok: false } : { unknown: true }; journal = recordReply(journal, next.step, next.page, reply); await persist(journal); throw e; }
    journal = recordReply(journal, next.step, next.page, reply); await persist(journal);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { summary(`### Failed\n${e.message}`); process.exit(1); });
