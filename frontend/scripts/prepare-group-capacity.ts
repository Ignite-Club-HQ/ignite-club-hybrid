/** Offline automation: only writes a closed request queue; no key or canister calls. */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { prepareCapacityRequests, type ClosedPreparationRequest } from '../src/live/groupCapacityPreparation';
import type { GroupCapacity, PlacementPolicy } from '../src/live/groupPlacement';
const [evidenceFile, queueFile] = process.argv.slice(2);
if (!evidenceFile || !queueFile) throw new Error('Usage: prepare-group-capacity <verified-evidence.json> <requests.json>');
const input = JSON.parse(readFileSync(evidenceFile, 'utf8')) as { groups: GroupCapacity[]; policy: PlacementPolicy };
if (!Array.isArray(input.groups) || !input.policy?.currentGroupId) throw new Error('Verified inventory and current group required');
const existing: ClosedPreparationRequest[] = existsSync(queueFile) ? JSON.parse(readFileSync(queueFile, 'utf8')) : [];
if (!Array.isArray(existing)) throw new Error('Invalid preparation queue');
const result = prepareCapacityRequests(input.groups, { ...input.policy, nowMs: Date.now() }, existing);
if (result.blocked.length) throw new Error(result.blocked.join('; '));
writeFileSync(`${queueFile}.tmp`, JSON.stringify(result.requests, null, 2) + '\n');
renameSync(`${queueFile}.tmp`, queueFile);
console.log(`${result.requests.length} closed request(s); no canisters created or opened.`);
