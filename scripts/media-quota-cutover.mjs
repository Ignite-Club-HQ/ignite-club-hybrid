/** Explicit, dry-run-first governor operations. Never deploy or move bytes. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const phase = args[0];
const phases = ['register', 'freeze', 'import', 'activate', 'recover', 'migrate-storage', 'enable-storage'];
if (!phases.includes(phase)) throw new Error(`Choose ${phases.join(', ')}.`);
if (args.slice(1).some(a => !['--apply', '--ack-all-stores'].includes(a))) throw new Error('Unknown option');
const apply = args.includes('--apply');
const target = process.env.DEPLOY_TARGET ?? 'mainnet';
const environment = process.env.ICP_ENV ?? 'ic';
if (!/^[a-zA-Z0-9_-]+$/.test(target) || !/^[a-zA-Z0-9_-]+$/.test(environment)) throw new Error('Invalid target/environment');
const cwd = resolve(root, 'deploy', target);
const mappings = JSON.parse(readFileSync(resolve(cwd, '.icp/data/mappings', `${environment}.ids.json`), 'utf8'));
const principal = name => {
  const value = mappings[name];
  const id = typeof value === 'string' ? value : value?.[environment] ?? value?.id;
  if (!/^[a-z0-9-]+-cai$/.test(id ?? '')) throw new Error(`Missing or invalid mapping: ${name}`);
  return id;
};
const stores = Object.keys(mappings).filter(k => /^media_blob_store(?:_[1-9]\d*)?$/.test(k)).sort();
if (stores.length === 0 || stores.length > 64) throw new Error('Expected 1–64 mapped media stores');
const club = principal('club_domain');
for (const store of stores) principal(store);
if (apply && ['freeze', 'activate', 'migrate-storage', 'enable-storage'].includes(phase) && !args.includes('--ack-all-stores')) throw new Error('Acknowledge that mappings include EVERY store with --ack-all-stores');
function run(command) {
  if (!apply) { console.log(`icp ${command.join(' ')}`); return ''; }
  const result = spawnSync('icp', command, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'ICP command failed');
  return result.stdout;
}
if (apply) {
  const governor = process.env.GOVERNOR;
  if (!governor) throw new Error('Set GOVERNOR to the configured deployment principal');
  if (!run(['--version']).includes('1.7.0')) throw new Error('Use pinned ICP CLI 1.7.0');
  if (run(['identity', 'principal']).trim() !== governor) throw new Error('Current identity is not GOVERNOR');
}
function call(name, method, input) {
  const output = run(['canister', 'call', name, method, input, '-e', environment, '-o', 'candid']);
  if (apply && /\bErr\b/.test(output)) throw new Error(`${method} rejected: ${output}`);
  if (output) console.log(output.trim());
  return output;
}
console.log(`${apply ? 'Applying' : 'Previewing'} ${phase}; stores: ${stores.join(', ')}. No deployments, reinstalls or file moves.`);
if (phase === 'register') {
  for (const store of stores) call('club_domain', 'register_media_quota_store', `(principal "${principal(store)}")`);
  call('club_domain', 'start_media_quota_cutover', '()');
}
if (phase === 'freeze') for (const store of stores) call(store, 'freeze_media_quota', '()');
if (phase === 'import') {
  for (const store of stores) {
    // Each call imports at most 200 rows. Repeat this phase until every
    // status row says done=true. No browser/operator row payload is accepted.
    call('club_domain', 'import_media_quota_store', `(principal "${principal(store)}")`);
  }
  call('club_domain', 'media_quota_cutover_status', '()');
}
if (phase === 'activate') {
  call('club_domain', 'activate_media_quota', '()');
  for (const store of stores) call(store, 'enable_shared_media_quota', '()');
}
if (phase === 'migrate-storage' || phase === 'enable-storage') {
  for (const store of stores) {
    call(store, phase === 'migrate-storage' ? 'migrate_legacy_blob' : 'enable_stable_media_storage', '()');
    call(store, 'stable_storage_status', '()');
  }
}
if (phase === 'recover') {
  const cursor = process.env.QUOTA_CURSOR ?? '';
  const usage = process.env.QUOTA_USAGE_CURSOR ?? '';
  if ([cursor, usage].some(c => c.length > 512)) throw new Error('Invalid cursor length');
  const text = value => '"' + value.replace(/["\\\x00-\x1f]/g, c => c === '"' ? '\\"' : c === '\\' ? '\\\\' : '\\' + c.charCodeAt(0).toString(16).padStart(2, '0')) + '"';
  const selected = process.env.MEDIA_QUOTA_STORE;
  if (selected && !stores.includes(selected)) throw new Error('Unknown recovery store');
  for (const store of selected ? [selected] : stores) {
    call(store, 'reconcile_upload_operations', `(${text(cursor)})`);
    call(store, 'retire_upload_outcomes', `(${text(cursor)})`);
  }
  call('club_domain', 'retire_media_quota_records', `(${text(cursor)}, ${text(usage)})`);
}
console.log(`Authority: ${club}. Resume failed phases; never revert an activated store to local quota.`);