export type SyntheticNativeBuildContract = {
  appId: string;
  webDirectory: string;
  serverUrl?: string;
  schemes: {
    android: 'https';
    ios: 'https';
  };
  notificationOwners: {
    capacitor: boolean;
    firebase: boolean;
  };
  runtimeVersions: {
    core: string;
    android: string;
    ios: string;
    cli: string;
    tar: string;
  };
  nodeVersions: number[];
  buildSteps: string[];
};

export type NativeUpgradeViolation =
  | 'invalid-app-id'
  | 'invalid-web-directory'
  | 'remote-server-url'
  | 'invalid-scheme'
  | 'duplicate-notification-owner'
  | 'runtime-major-mismatch'
  | 'unsupported-cli'
  | 'vulnerable-tar'
  | 'unsupported-node'
  | 'missing-platform-build';

function versionTuple(version: string): readonly [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unsupported semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(actual: string, minimum: string): boolean {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export function validateSyntheticNativeUpgrade(
  contract: SyntheticNativeBuildContract,
): NativeUpgradeViolation[] {
  const violations: NativeUpgradeViolation[] = [];
  if (!/^app\.synthetic\.[a-z0-9-]+$/.test(contract.appId)) violations.push('invalid-app-id');
  if (contract.webDirectory !== 'dist') violations.push('invalid-web-directory');
  if (contract.serverUrl) violations.push('remote-server-url');
  if (contract.schemes.android !== 'https' || contract.schemes.ios !== 'https') {
    violations.push('invalid-scheme');
  }
  if (contract.notificationOwners.capacitor === contract.notificationOwners.firebase) {
    violations.push('duplicate-notification-owner');
  }

  const runtimeMajors = [
    contract.runtimeVersions.core,
    contract.runtimeVersions.android,
    contract.runtimeVersions.ios,
  ].map(version => versionTuple(version)[0]);
  if (new Set(runtimeMajors).size !== 1 || runtimeMajors[0] !== 8) {
    violations.push('runtime-major-mismatch');
  }
  if (
    versionTuple(contract.runtimeVersions.cli)[0] !== 8 ||
    !isAtLeast(contract.runtimeVersions.cli, '8.4.2')
  ) {
    violations.push('unsupported-cli');
  }
  if (!isAtLeast(contract.runtimeVersions.tar, '7.5.19')) violations.push('vulnerable-tar');
  if (contract.nodeVersions.length === 0 || contract.nodeVersions.some(version => version < 22)) {
    violations.push('unsupported-node');
  }
  if (
    !contract.buildSteps.includes('sync-android') ||
    !contract.buildSteps.includes('sync-ios') ||
    !contract.buildSteps.includes('build-android') ||
    !contract.buildSteps.includes('build-ios')
  ) {
    violations.push('missing-platform-build');
  }
  return violations;
}
