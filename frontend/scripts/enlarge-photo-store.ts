/** Switches a group's photo store (Group 1 shared store, or a group's dedicated store from deploy/groups/gN/provision.json) to the larger stable-backed mode (owner-approved 2026-10-21; Group 1 holds test data only). */
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { DEPLOYED_MAINNET_CANISTER_IDS as LIVE } from '../src/live/generated/deployedCanisterIds';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { DEPLOY_PRINCIPAL } from '../../scripts/media-card-funding-policy.mjs';
import { capacityBytesFor, assertEnlargeConfirmation, groupNumber } from '../../scripts/enlarge-photo-store-policy.mjs';
import { readFileSync } from 'node:fs';

const group = groupNumber(process.env.ENLARGE_GROUP ?? '1');
assertEnlargeConfirmation(process.env.ENLARGE_CONFIRM, group);
const limit = capacityBytesFor(process.env.ENLARGE_GIB);
const identity = loadOperatorIdentity(process.env.OPERATOR_PEM_PATH ?? '');
if (identity.getPrincipal().toText() !== DEPLOY_PRINCIPAL) throw new Error('Loaded key is not the deploy identity; nothing changed');
const target: string = group === '1' ? LIVE.media_blob_store : (() => {
  const p = JSON.parse(readFileSync(new URL(`../../deploy/groups/g${group}/provision.json`, import.meta.url), 'utf8'));
  const id = p?.dedicatedBlobStore?.canisterId;
  if (!id || p.dedicatedBlobStore.installed !== true) throw new Error(`Group ${group} has no installed photo store on record; nothing changed`);
  if (id === LIVE.media_blob_store) throw new Error('Refusing: that is the shared Group 1 store');
  return id;
})();
const agent = await HttpAgent.create({ identity, host: 'https://icp-api.io', shouldFetchRootKey: false });
const store: any = Actor.createActor(idlFactory as any, { agent, canisterId: target });
const ok = (r: any, what: string) => { if (r && 'Err' in r) throw new Error(`${what}: ${r.Err}`); return r?.Ok; };

let status = await store.stable_storage_status();
console.log(`Store ${target}: larger storage ${status.enabled ? 'already on' : 'off'}, ${status.legacy_count} files to copy`);
if (!status.enabled) {
  // Unfinished uploads block the switch-over; the deploy identity may abort them.
  // Aborted uploads simply fail for the uploader, who can retry afterwards.
  let listed: any;
  try {
    listed = await store.read_pending_uploads();
  } catch (e: any) {
    if (/IC0536|has no (update|query) method/.test(String(e?.message ?? e))) {
      throw new Error('This photo store is still running the old version (it lacks the unfinished-upload cleanup). Nothing was changed. Run the mainnet deploy workflow first, then re-run this.');
    }
    throw e;
  }
  const pending = ok(listed, 'Listing unfinished uploads failed') as { id: string; path: string }[];
  for (const u of pending) {
    ok(await store.abort_upload(u.id), `Aborting unfinished upload ${u.id} failed`);
    console.log(`Aborted unfinished upload ${u.id} (${u.path})`);
  }
  if (pending.length > 0) console.log(`Drained ${pending.length} unfinished upload(s)`);
  let copied = 0;
  for (;;) {
    const r = ok(await store.migrate_legacy_blob(), 'Copying a file failed');
    copied++;
    if (copied % 25 === 0 || r.remaining === 0n) console.log(`Copied ${copied}; ${r.remaining} left`);
    if (r.remaining === 0n) break;
  }
  ok(await store.enable_stable_media_storage(), 'Switching to larger storage failed');
}
ok(await store.set_capacity_limit(limit), 'Setting the new size failed');
const usage = await store.get_usage();
console.log(`Now holds ${usage.total_bytes} bytes; size limit ${usage.capacity_limit_bytes} bytes; accepting uploads: ${usage.accepting_uploads}`);
if (usage.capacity_limit_bytes < limit) throw new Error('Size did not take effect: the larger-storage setting is not deployed on this store yet. Run the mainnet deploy first, then re-run this.');
console.log(`Group ${group} photo store enlarged.`);
