import { describe, expect, it } from 'vitest';
import { ENGINE_REQUIRED_CANISTERS, enginePreparationIssues, validateDeploymentPreparation } from './enginePreparation';
import { DEFAULT_BACKEND_ROUTING_CONFIG, isCloudEngineUsable, normalizeApprovedTarget, parseBackendRoutingConfig } from './backendRouting';
import { DEPLOYED_MAINNET_CANISTER_IDS } from './generated/deployedCanisterIds';
const preparation = { deploymentId: 'future-engine', primarySubnet: 'e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe', groupIds: ['g3', 'g4'], proxyCanisterId: 'rrkah-fqaaa-aaaaa-aaaaq-cai' };
describe('engine preparation', () => {
  it('blocks fully mapped engines pending real-engine acceptance', () => {
    const engine = normalizeApprovedTarget({ backend: 'icp', kind: 'icp-cloud-engine', alias: 'future-engine', version: 'v1', enabled: true, host: 'https://engine.example.com', canisterIds: DEPLOYED_MAINNET_CANISTER_IDS, preparation });
    expect(isCloudEngineUsable(engine)).toBe(false);
    expect(enginePreparationIssues(engine)).toEqual(['Engine installation, encryption and cross-subnet acceptance pending']);
  });
  it('requires all group services and shared control mappings', () => {
    for (const key of ENGINE_REQUIRED_CANISTERS) {
      const ids = { ...DEPLOYED_MAINNET_CANISTER_IDS }; delete ids[key];
      expect(enginePreparationIssues({ canisterIds: ids, preparation }).some(issue => issue.includes(key))).toBe(true);
    }
  });
  it('rejects duplicate group links', () => {
    expect(() => validateDeploymentPreparation({ ...preparation, groupIds: ['g3', 'g3'] })).toThrow();
  });
  it('preserves deployment/group/proxy links on save and read', () => {
    const engine = normalizeApprovedTarget({ backend: 'icp', kind: 'icp-cloud-engine', alias: 'future-engine', version: 'v1', enabled: false, preparation });
    expect(parseBackendRoutingConfig({ ...DEFAULT_BACKEND_ROUTING_CONFIG, targets: [engine] })?.targets[0].preparation).toEqual(preparation);
  });
  it('rejects duplicate service mappings', () => {
    expect(enginePreparationIssues({ canisterIds: { club_domain: 'rrkah-fqaaa-aaaaa-aaaaq-cai', vault_domain: 'rrkah-fqaaa-aaaaa-aaaaq-cai' } })).toContain('Duplicate service canister IDs');
  });
});