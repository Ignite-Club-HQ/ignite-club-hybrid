/** Prepare an additional store, never deploy, fund or change existing IDs. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const name = args[0];
const apply = args.includes('--apply');
if (!/^media_blob_store_[2-9]\d*$/.test(name ?? '') && !/^media_blob_store_1\d+$/.test(name ?? '')) {
  throw new Error('Use media_blob_store_N with N >= 2.');
}
if (args.some((arg, i) => i > 0 && arg !== '--apply')) throw new Error('Unknown option');
const target = resolve(root, 'backend', name);
if (existsSync(target)) throw new Error('Store source already exists; refusing to overwrite.');
const source = resolve(root, 'backend/media_blob_store');
const manifest = readFileSync(resolve(source, 'canister.yaml'), 'utf8').replace('name: media_blob_store', `name: ${name}`);
const mops = readFileSync(resolve(source, 'mops.toml'), 'utf8')
  .replaceAll('[canisters.media_blob_store', `[canisters.${name}`)
  .replace('main = "src/main.mo"', 'main = "../media_blob_store/src/main.mo"')
  .replace('candid = "media_blob_store.did"', 'candid = "../media_blob_store/media_blob_store.did"')
  .replace('chain = "src/backend/migrations"', 'chain = "../media_blob_store/src/backend/migrations"')
  .replace('name = "media_blob_store"', `name = "${name}"`);
if (apply) {
  mkdirSync(target);
  writeFileSync(resolve(target, 'canister.yaml'), manifest);
  writeFileSync(resolve(target, 'mops.toml'), mops);
}
console.log(`${apply ? 'Prepared' : 'Would prepare'} ${name} with shared source and migrations.`);
console.log('No deployment, routing or ID mappings changed.');
console.log('Before activation: add it to the chosen deploy manifest/environment, verify governor wiring, and enforce club-wide quotas across stores.');