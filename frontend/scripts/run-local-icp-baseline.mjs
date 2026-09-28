#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const env = { ...process.env };

function run(label, command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit status ${result.status}`);
  return `${result.stdout}\n${result.stderr}`;
}

const countPassed = (output, pattern, label) => {
  const match = output.match(pattern);
  if (!match) throw new Error(`Could not read ${label} count from output`);
  return Number(match[1]);
};

const parseJsonBlock = (output, label) => {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error(`Could not read ${label} JSON output`);
  return JSON.parse(output.slice(start, end + 1));
};

let deployed = false;
try {
  run('local ICP deployment', 'node', ['scripts/local-icp.mjs', 'deploy']);
  deployed = true;

  const internetIdentity = run('local Internet Identity smoke', 'node', ['scripts/test-local-internet-identity.mjs']);
  const backendSwitch = run(
    'backend switch e2e',
    'npx',
    ['playwright', 'test', '--config', 'playwright.config.ts', 'e2e/backend-switch.spec.ts'],
    { IGNITE_LAB_BACKEND_SWITCH_E2E: '1' },
  );
  const messagingPerformance = run('ICP messaging performance', 'node', ['scripts/test-icp-messaging-performance.mjs', '--json']);

  const report = {
    localInternetIdentity: parseJsonBlock(internetIdentity, 'local Internet Identity'),
    backendSwitchPlaywright: countPassed(backendSwitch, /(\d+) passed/, 'backend switch Playwright'),
    messagingPerformance: parseJsonBlock(messagingPerformance, 'ICP messaging performance'),
  };
  console.log(`LOCAL_ICP_BASELINE_REPORT=${JSON.stringify(report)}`);
} finally {
  if (deployed) run('local ICP shutdown', 'node', ['scripts/local-icp.mjs', 'stop']);
}
