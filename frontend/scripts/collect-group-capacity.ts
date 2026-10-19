/** Offline: health readings + tested limits -> capacity-evidence.json. No keys, no canister writes. */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { collectGroupCapacity, type HealthRow, type TestedLimits } from '../src/live/groupCapacityCollector';
const [healthFile, limitsFile, outFile] = process.argv.slice(2);
if (!healthFile || !limitsFile || !outFile) throw new Error('Usage: collect-group-capacity <health.json> <tested-limits.json> <evidence.json>');
const rows = JSON.parse(readFileSync(healthFile, 'utf8')) as HealthRow[];
const limits = JSON.parse(readFileSync(limitsFile, 'utf8')) as TestedLimits;
const { group, problems } = collectGroupCapacity(rows, limits, Date.now());
if (!group) throw new Error(`No evidence written: ${problems.join('; ')}`);
const policy = { deploymentId: limits.deploymentId, primarySubnet: limits.subnetId,
  additionalSubnetsEnabled: false, approvedSubnets: [limits.subnetId], currentGroupId: limits.groupId };
writeFileSync(`${outFile}.tmp`, JSON.stringify({ groups: [group], policy }, null, 2) + '\n');
renameSync(`${outFile}.tmp`, outFile);
console.log(`Evidence for ${group.groupId}: ${group.capacity!.readings.length} readings, fuel ${group.cyclesHealthy ? 'ok' : 'LOW — top up'}`);
