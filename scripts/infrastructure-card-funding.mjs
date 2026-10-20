import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { infrastructurePlan, statusEvidence, GROUP_SERVICES, applyTopups } from './infrastructure-card-funding-policy.mjs';

export function prepareInfrastructure({ cli, identity, balance }) {
  const root = process.env.GITHUB_WORKSPACE;
  if (!root) throw new Error('Repository required');
  const groupId = process.env.FUNDING_GROUP_ID;
  if (!/^g[0-9]{1,3}$/.test(groupId ?? '')) throw new Error('Invalid group');
  const file = join(root, 'deploy/groups', groupId, 'provision.json');
  const purpose = process.env.FUNDING_PURPOSE;
  let readings = [], fee = 0n;
  const status = id => statusEvidence(cli(['canister', 'status', id, '-n', 'ic', '--identity', identity, '--json']), id);
  if (purpose === 'top-ups') {
    let targets;
    if (groupId === 'g1') {
      targets = { ...JSON.parse(readFileSync(join(root, 'deploy/mainnet/.icp/data/mappings/ic.ids.json'), 'utf8')), frontend: 'proe7-kqaaa-aaaas-qg6gq-cai' };
    } else {
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const limits = JSON.parse(readFileSync(join(root, 'deploy/groups/tested-limits.json'), 'utf8'));
      if (r.groupId !== groupId || r.deploymentId !== limits.deploymentId || r.subnetId !== limits.subnetId || !['checked', 'registered', 'enabled'].includes(r.phase) || r.pending) throw new Error('Group record incomplete or foreign');
      targets = { ...r.canisters, media_blob_store: r.dedicatedBlobStore?.canisterId };
      if ([...GROUP_SERVICES, 'media_blob_store'].some(n => typeof targets[n] !== 'string')) throw new Error('Missing group services');
    }
    if (Object.values(targets).some(id => typeof id !== 'string' || !/^[a-z0-9-]+-cai$/.test(id))) throw new Error('Invalid canister mapping');
    readings = Object.entries(targets).map(([name, id]) => ({ name, ...status(id) }));
    const feeReply = cli(['canister', 'call', 'um5iw-rqaaa-aaaaq-qaaba-cai', 'icrc1_fee', '()', '-n', 'ic', '--identity', identity, '--query']);
    const match = feeReply.match(/^\(\s*([\d_]+)\s*:\s*nat\s*\)\s*$/);
    if (!match) throw new Error('Cannot verify current ledger withdrawal fee');
    fee = BigInt(match[1].replaceAll('_', ''));
  }
  const plan = infrastructurePlan({ paymentId: process.env.PAYMENT_ID, purpose, groupId,
    principal: cli(['identity', 'principal', '--identity', identity]), confirm: process.env.CARD_CONFIRM,
    balance: balance(), readings, targetT: process.env.TOPUP_TARGET_T, fee, existingGroup: existsSync(file) });
  return { plan, finish: async ({ state, save, summary }) => {
    if (purpose === 'new-group') {
      summary(`Funding stays in the deploy account. Run **Install new group (closed)** separately for ${groupId}; default 1.5T per service, 13 services. No group was created or opened.`);
      return;
    }
    await applyTopups({ plan, state, save, balance, status,
      transfer: (id, amount) => cli(['canister', 'top-up', id, '--amount', amount, '-n', 'ic', '--identity', identity]) });
    for (const r of state.transfers) summary(`Verified ${r.name} (${r.id}): ${r.beforeCycles} → ${r.afterCycles} cycles; deposit ${r.amount}.`);
    summary(`Low-fuel top-ups complete for ${groupId}. Rerun Canister health report to review current readings.`);
  } };
}