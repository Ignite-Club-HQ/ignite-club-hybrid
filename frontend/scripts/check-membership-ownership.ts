/** Operator-only consensus evidence. Does not configure, upgrade, place clubs,
 * grant access, store raw membership relationships or authorize cutover. */
import { readFileSync, writeFileSync } from 'node:fs';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE as RouterService } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { checkLegacyOwnership } from '../../scripts/membership-legacy-ownership.mjs';
import { GROUP2_GOVERNOR } from '../../scripts/group2-upgrade-rules.mjs';
import { membershipOwnershipTransport } from './membership-ownership-transport';

const [pem, output] = process.argv.slice(2);
if (!pem || !output) throw new Error('Existing governor key path and output path required');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GROUP2_GOVERNOR) throw new Error('Existing governor required');
const shared = JSON.parse(readFileSync(new URL('../../deploy/mainnet/.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
if (shared.club_domain !== 'mzzzv-taaaa-aaaal-qxlrq-cai' || shared.shard_router !== 'jcdfe-vqaaa-aaaal-qxloq-cai') throw new Error('Pinned original authority mapping required');
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const router = Actor.createActor<RouterService>(routerIdl, { agent, canisterId: shared.shard_router });
const registry = () => readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page('mainnet', rev, cursor, limit));
const report = await checkLegacyOwnership(membershipOwnershipTransport(agent, registry));
// Only club IDs and source revision/count observations are emitted, never ACLs.
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log('Owner-named clubs cross-checked against all complete source exports; no ownership or readiness changes.');