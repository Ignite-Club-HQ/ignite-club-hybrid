/** Inactive operator composition: reciprocal domain settings, not identity
 * admission or activation. Authenticated transport is supplied externally. */
import { Principal } from '@icp-sdk/core/principal';
import { PER_GROUP_DOMAINS, type Provision, type ProvisionCheckpoint } from './groupProvisioner';
import type { GroupDomain } from './groupRouting';

type ConfigurationDomain = GroupDomain | 'media_blob_store';
type Operation = { domain: ConfigurationDomain; method: string; args: unknown[] };
export type ConfigurationTransport = {
  // Must verify this exact operator still controls the bound canister.
  verifyGovernor(canisterId: string, governor: string): Promise<void>;
  call(canisterId: string, method: string, args: unknown[]): Promise<{ Ok: unknown } | { Err: string }>;
};
export type ConfigurationGlobals = { identityAccess: string; pushWorker: string; mediaBlobStore: string };

export function groupConfigurationPlan(p: Provision, globals: ConfigurationGlobals) {
  const ids = PER_GROUP_DOMAINS.map(d => p.canisters[d]);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || p.canisters.secret_workload_identity) throw new Error('Incomplete or duplicate domain inventory');
  const principal = (id: string | undefined) => {
    if (!id) throw new Error('Missing configuration principal');
    const value = Principal.fromText(id);
    if (value.isAnonymous() || value.toText() === 'aaaaa-aa') throw new Error('Invalid configuration principal');
    return value;
  };
  ids.forEach(principal);
  const identity = principal(globals.identityAccess), worker = principal(globals.pushWorker), blob = principal(globals.mediaBlobStore);
  if (ids.includes(identity.toText()) || ids.includes(worker.toText()) || ids.includes(blob.toText()) || new Set([identity.toText(), worker.toText(), blob.toText()]).size !== 3) throw new Error('Global identity, worker or media store duplicated in group');
  const operations: Operation[] = [];
  operations.push({ domain: 'media_blob_store', method: 'set_club_domain_canister', args: [principal(p.canisters.club_domain)] });
  operations.push({ domain: 'club_domain', method: 'register_media_quota_store', args: [blob] });
  operations.push({ domain: 'vault_domain', method: 'set_vault_stores', args: [[blob]] });
  operations.push({ domain: 'media_blob_store', method: 'set_vault_authority', args: [principal(p.canisters.vault_domain)] });
  operations.push({ domain: 'timer_jobs', method: 'grant_worker', args: [worker] });
  const link = (domain: GroupDomain, method: string, target: GroupDomain, vector = false) => {
    const id = principal(p.canisters[target]);
    operations.push({ domain, method, args: [vector ? [id] : id] });
  };
  for (const domain of ['pii_access_control', 'vault_domain', 'club_points_domain', 'messaging_domain', 'notification_queue', 'events_domain', 'competition_domain', 'mini_league_domain'] as const) {
    link(domain, 'set_club_domain_canister', 'club_domain');
  }
  for (const domain of ['messaging_domain', 'club_domain', 'events_domain'] as const) link(domain, 'set_notification_queue_canister', 'notification_queue');
  operations.push({ domain: 'media_metadata', method: 'set_gallery_authorities', args: [principal(p.canisters.club_domain), principal(p.canisters.vault_domain)] });
  link('club_domain', 'set_gallery_media_authority', 'media_metadata');
  link('vault_domain', 'set_gallery_media_authority', 'media_metadata');
  link('vault_domain', 'set_messaging_domain_canister', 'messaging_domain');
  link('messaging_domain', 'set_vault_domain_canister', 'vault_domain');
  link('notification_queue', 'set_messaging_domain_canister', 'messaging_domain');
  operations.push({ domain: 'notification_queue', method: 'set_identity_access_canister', args: [identity] });
  operations.push({ domain: 'notification_queue', method: 'grant_worker', args: [worker] });
  link('club_domain', 'set_events_domain_canister', 'events_domain');
  link('club_domain', 'set_messaging_domain_canister', 'messaging_domain');
  link('club_domain', 'set_pii_canister', 'pii_access_control');
  link('club_domain', 'set_mini_league_domain_canister', 'mini_league_domain');
  link('club_domain', 'set_competition_domain_canister', 'competition_domain');
  link('club_domain', 'set_competition_authorities', 'competition_domain', true);
  link('competition_domain', 'set_participant_club_authorities', 'club_domain', true);
  for (const domain of ['pii_access_control', 'vault_domain', 'messaging_domain', 'events_domain'] as const) link(domain, 'set_competition_domain_canister', 'competition_domain');
  link('competition_domain', 'set_events_domain_canister', 'events_domain');
  link('competition_domain', 'set_vault_domain_canister', 'vault_domain');
  link('competition_domain', 'set_pii_access_control_canister', 'pii_access_control');
  link('events_domain', 'set_mini_league_domain_canister', 'mini_league_domain');
  link('mini_league_domain', 'set_events_domain_canister', 'events_domain');
  return operations;
}

export async function configureProvisionGroup(start: Provision, checkpoint: ProvisionCheckpoint, transport: ConfigurationTransport, governor: string, globals: ConfigurationGlobals) {
  const operator = Principal.fromText(governor);
  if (operator.isAnonymous() || operator.toText() === 'aaaaa-aa') throw new Error('Authenticated governor required');
  if (start.pending) throw new Error('Unresolved configuration intent');
  const operations = groupConfigurationPlan(start, globals);
  const binding = JSON.stringify([start.id, start.groupId, start.deploymentId, start.subnetId, governor,
    PER_GROUP_DOMAINS.map(d => [d, start.canisters[d]]), globals.identityAccess, globals.pushWorker, globals.mediaBlobStore]);
  if (start.configuration && start.configuration.binding !== binding) throw new Error('Configuration binding changed');
  const names = operations.map(op => `${op.domain}.${op.method}`);
  const completed = start.configuration?.completed ?? [];
  if (new Set(completed).size !== completed.length || completed.some(name => !names.includes(name))) throw new Error('Invalid configuration receipts');
  let p = { ...start, configuration: { binding, completed: [...completed] } };
  await checkpoint(p);
  // Recheck the whole controlled inventory on every resume, not just endpoints
  // with unfinished settings. Infrastructure state is never a resource grant.
  for (const domain of PER_GROUP_DOMAINS) {
    const id = p.canisters[domain];
    if (!id) throw new Error('Incomplete configuration inventory');
    await transport.verifyGovernor(id, governor);
  }
  await transport.verifyGovernor(globals.mediaBlobStore, governor);
  for (const operation of operations) {
    const name = `${operation.domain}.${operation.method}`;
    if (p.configuration.completed.includes(name)) continue;
    const id = operation.domain === 'media_blob_store' ? globals.mediaBlobStore : p.canisters[operation.domain];
    if (!id) throw new Error('Missing configuration receiver');
    await transport.verifyGovernor(id, governor);
    p = { ...p, pending: { kind: 'configure', operation: name } };
    await checkpoint(p); // durable intent precedes external mutation
    const result = await transport.call(id, operation.method, operation.args);
    // A lost reply/failed acknowledgement retains the exact unresolved intent.
    if ('Err' in result) throw new Error(`${name}: ${result.Err}`);
    p = { ...p, pending: undefined, configuration: { binding, completed: [...p.configuration.completed, name] } };
    await checkpoint(p);
  }
}