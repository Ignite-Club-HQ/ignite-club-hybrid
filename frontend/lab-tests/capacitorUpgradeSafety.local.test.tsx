import { describe, expect, it } from 'vitest';

import {
  validateSyntheticNativeUpgrade,
  type SyntheticNativeBuildContract,
} from '../src/lab/nativeUpgradePolicy';

const safeContract = (): SyntheticNativeBuildContract => ({
  appId: 'app.synthetic.ignite-lab',
  webDirectory: 'dist',
  schemes: { android: 'https', ios: 'https' },
  notificationOwners: { capacitor: true, firebase: false },
  runtimeVersions: {
    core: '8.4.2',
    android: '8.4.2',
    ios: '8.4.2',
    cli: '8.4.2',
    tar: '7.5.19',
  },
  nodeVersions: [22, 24],
  buildSteps: ['sync-android', 'sync-ios', 'build-android', 'build-ios'],
});

describe('local equivalent of the Capacitor upgrade acceptance gate', () => {
  it('accepts a synthetic contract with aligned runtimes and both platform build paths', () => {
    expect(validateSyntheticNativeUpgrade(safeContract())).toEqual([]);
  });

  it('fails closed for remote hosting, duplicate notification ownership, or incomplete builds', () => {
    const contract = safeContract();
    contract.serverUrl = 'https://production.example.invalid';
    contract.notificationOwners.firebase = true;
    contract.buildSteps = ['sync-android', 'build-android'];

    expect(validateSyntheticNativeUpgrade(contract)).toEqual([
      'remote-server-url',
      'duplicate-notification-owner',
      'missing-platform-build',
    ]);
  });

  it('rejects runtime drift and the exported vulnerable-version boundaries', () => {
    const contract = safeContract();
    contract.runtimeVersions.ios = '7.9.0';
    contract.runtimeVersions.cli = '8.4.1';
    contract.runtimeVersions.tar = '7.5.18';
    contract.nodeVersions = [20, 22];

    expect(validateSyntheticNativeUpgrade(contract)).toEqual([
      'runtime-major-mismatch',
      'unsupported-cli',
      'vulnerable-tar',
      'unsupported-node',
    ]);
  });
});
