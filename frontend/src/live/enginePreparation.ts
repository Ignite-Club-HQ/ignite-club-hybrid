import { GROUP_DOMAINS } from './groupRouting';

/** Configuration evidence only; never an operator release or group registration. */
export type DeploymentPreparation = {
  deploymentId: string;
  primarySubnet: string;
  groupIds: string[];
  proxyCanisterId: string;
};

export const ENGINE_REQUIRED_CANISTERS = [...GROUP_DOMAINS, 'media_blob_store', 'identity_access', 'placement_registry', 'shard_router'] as const;
/** Requires real engine encryption/call/install acceptance, not an admin checkbox. */
export const CLOUD_ENGINE_RELEASED = false;

export function validateDeploymentPreparation(value: unknown): DeploymentPreparation | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Deployment preparation must be an object.');
  const v = value as Record<string, unknown>;
  const text = (key: string) => {
    if (v[key] !== undefined && typeof v[key] !== 'string') throw new Error(`${key} must be text.`);
    return String(v[key] ?? '').trim();
  };
  const deploymentId = text('deploymentId');
  const primarySubnet = text('primarySubnet');
  const proxyCanisterId = text('proxyCanisterId');
  if (deploymentId && !/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(deploymentId)) throw new Error('Invalid deployment ID.');
  for (const [label, id] of [['Subnet', primarySubnet], ['Proxy', proxyCanisterId]]) {
    if (id && (!/^[a-z0-9-]{10,63}$/.test(id) || id === '2vxsx-fae')) throw new Error(`${label} must be a principal ID.`);
  }
  if (v.groupIds !== undefined && !Array.isArray(v.groupIds)) throw new Error('Group IDs must be a list.');
  const groupIds = (v.groupIds as unknown[] | undefined ?? []).map(id => {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,62}$/i.test(id.trim())) throw new Error('Invalid group ID.');
    return id.trim();
  });
  if (groupIds.length > 64 || new Set(groupIds).size !== groupIds.length) throw new Error('Group IDs must be unique, with at most 64 groups.');
  return { deploymentId, primarySubnet, proxyCanisterId, groupIds };
}

export function enginePreparationIssues(target: { host?: string; canisterIds?: Record<string, string>; preparation?: DeploymentPreparation }): string[] {
  const issues: string[] = [];
  if (!target.host) issues.push('Engine address missing');
  const missing = ENGINE_REQUIRED_CANISTERS.filter(key => !target.canisterIds?.[key]);
  if (missing.length) issues.push(`Missing services: ${missing.join(', ')}`);
  const ids = Object.values(target.canisterIds ?? {});
  if (new Set(ids).size !== ids.length) issues.push('Duplicate service canister IDs');
  if (!target.preparation?.deploymentId) issues.push('Deployment ID missing');
  if (!target.preparation?.primarySubnet) issues.push('Primary subnet missing');
  if (!target.preparation?.groupIds.length) issues.push('No planned groups linked');
  if (!target.preparation?.proxyCanisterId) issues.push('Encryption proxy missing');
  if (!CLOUD_ENGINE_RELEASED) issues.push('Engine installation, encryption and cross-subnet acceptance pending');
  return issues;
}