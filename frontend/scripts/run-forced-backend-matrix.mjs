import { spawnSync } from 'node:child_process';

const backend = process.argv[2];
if (backend !== 'icp' && backend !== 'supabase') {
  throw new Error('Usage: node scripts/run-forced-backend-matrix.mjs <icp|supabase>');
}

const env = { ...process.env, IGNITE_LAB_FORCED_BACKEND: backend };
const run = (label, command, args) => {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, encoding: 'utf8' });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit status ${result.status}`);
  return `${result.stdout}\n${result.stderr}`;
};

// The imported legacy Vitest suite has one known pre-existing flake
// (react-virtuoso's internal RAF-driven measurement firing after a fake-timer
// test file has already unmounted; see requestAnimationFrame ReferenceError
// in VirtualizedChatMessageList.emptyMount.test.tsx). This is not related to
// backend selection - both forced modes run the exact same legacy suite, and
// direct standalone reruns pass 4162/4162 consistently. Retry once so a rare
// unhandled-rejection exit code doesn't misreport an otherwise-clean run;
// a genuine, reproducible test failure will still fail on the retry.
const runWithRetry = (label, command, args) => {
  try {
    return run(label, command, args);
  } catch (firstError) {
    console.warn(`${label} failed once; retrying to rule out the known legacy RAF timing flake.`);
    try {
      return run(label, command, args);
    } catch {
      throw firstError;
    }
  }
};

let deployed = false;
try {
  if (backend === 'icp') {
    run('local ICP deployment', 'node', ['scripts/local-icp.mjs', 'deploy']);
    deployed = true;
  }
  const lab = run('lab suite', 'npm', ['run', 'test']);
  const legacy = runWithRetry('legacy suite', 'npm', ['run', 'test:legacy']);
  const browser = run('browser suite', 'npm', ['run', 'test:e2e']);
  const count = (output, pattern, label) => {
    const match = output.match(pattern);
    if (!match) throw new Error(`Could not read ${label} count from test runner output`);
    return Number(match[1]);
  };
  const report = {
    mode: backend,
    localBackend: backend === 'icp' ? 'PocketIC canisters' : 'in-memory synthetic Supabase provider',
    testsExecutedUnderForcedMode: {
      nodeLab: count(lab, /(?:#|ℹ) tests\s+(\d+)/, 'Node lab'),
      labVitest: count(lab, /Tests\s+(\d+) passed/, 'lab Vitest'),
      legacyVitest: count(legacy, /Tests\s+(\d+) passed/, 'legacy Vitest'),
      playwright: count(browser, /(\d+) passed/, 'Playwright'),
    },
    backendIntegrationEvidence: 'The forced-backend Playwright CRUD contract exercises Club Links through the selected provider. Other retained tests execute under the forced build configuration but may be backend-agnostic or use explicit unit doubles.',
  };
  report.testsExecutedUnderForcedMode.total = Object.values(report.testsExecutedUnderForcedMode).reduce((sum, value) => sum + value, 0);
  console.log(`FORCED_BACKEND_MATRIX_REPORT=${JSON.stringify(report)}`);
} finally {
  if (deployed) run('local ICP shutdown', 'node', ['scripts/local-icp.mjs', 'stop']);
}
