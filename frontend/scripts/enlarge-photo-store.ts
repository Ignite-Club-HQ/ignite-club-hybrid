/** Switches Group 1's photo store to the larger stable-backed mode (owner-approved 2026-10-21; Group 1 holds test data only). */
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { DEPLOYED_MAINNET_CANISTER_IDS as LIVE } from '../src/live/generated/deployedCanisterIds';
import { idlFactory } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { DEPLOY_PRINCIPAL } from '../../scripts/media-card-funding-policy.mjs';
import { capacityBytesFor } from '../../scripts/enlarge-photo-store-policy.mjs';

if (process.env.ENLARGE_CONFIRM !== 'ENLARGE GROUP 1 PHOTO STORE') throw new Error('Confirmation missing; nothing changed');
const limit = capacityBytesFor(process.env.ENLARGE_GIB);
const identity = loadOperatorIdentity(process.env.OPERATOR_PEM_PATH ?? '');
if (identity.getPrincipal().toText() !== DEPLOY_PRINCIPAL) throw new Error('Loaded key is not the deploy identity; nothing changed');
const target = LIVE.media_blob_store;
const agent = await HttpAgent.create({ identity, host: 'https://icp-api.io', shouldFetchRootKey: false });
const store: any = Actor.createActor(idlFactory as any, { agent, canisterId: target });
const ok = (r: any, what: string) => { if (r && 'Err' in r) throw new Error(`${what}: ${r.Err}`); return r?.Ok; };

let status = await store.stable_storage_status();
console.log(`Store ${target}: larger storage ${status.enabled ? 'already on' : 'off'}, ${status.legacy_count} files to copy`);
if (!status.enabled) {
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
console.log('Group 1 photo store enlarged.');
